"""
Knowledge base tools — the agent's own tools, unlike everything else it can do
(see client.py: those come from the remote MCP server).

The bundle in ``docs/knowledge`` is written in Google's Open Knowledge Format:
a directory of Markdown files, each one concept, each carrying YAML frontmatter
(``type``, ``title``, ``description``, ``tags``, ``status``, ``sources``) that
says what the file is about. Documentation the agent can quote, in other words —
which the MCP tool surface cannot give it: those tools read *state* (which
employees exist, what the settings are), never *explanation* (what a capability
is for, why the solver refused a plan, how a ward manager confirms a roster).

Three tools, deliberately shaped like the bundle's own "start at an index and
follow links" instruction (see its index.md):

  - ``listKnowledgeTopics``  — the catalogue: every document's path, title and
    description. Cheap enough to read whole (~50 documents).
  - ``searchKnowledge``      — keyword search over frontmatter and body, best
    matches first, with a snippet of the matching lines.
  - ``readKnowledgeDoc``     — one document in full, by bundle path.

Search is lexical (weighted term frequency × inverse document frequency), not
embeddings: the corpus is a few dozen curated documents whose frontmatter already
states the subject, so titles, tags and descriptions carry most of the signal,
and there is no index to build, no model to ship, and nothing to keep in sync
with the bundle.

The bundle location is resolved at startup — ``SHIFT_AGENT_KNOWLEDGE_PATH``, or
``--knowledge-path`` on ``shift-agent chat`` / ``shift-agent api``. A missing
directory is not fatal: the tools are simply not offered, and the agent falls
back on the MCP tools alone.
"""

from __future__ import annotations

import logging
import math
import re
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path

import yaml
from langchain_core.tools import StructuredTool

from shift_agent.config import settings

logger = logging.getLogger(__name__)

# Frontmatter fences at the very top of a document: --- ... ---
_FRONTMATTER_RE = re.compile(r"\A---\r?\n(.*?)\r?\n---\r?\n?", re.DOTALL)
_WORD_RE = re.compile(r"[a-z0-9_]+")

# Words carrying no retrieval signal in questions phrased at the assistant
# ("how do I …", "what is a …").
_STOPWORDS = frozenset(
    """
    a an and are as at be by can do does for from has have how i if in into is it
    its me my of on or our so than that the their them then there these they this
    to us was we what when where which who why will with you your
    """.split()
)

# Field weights. Frontmatter is curated, the body is prose — a term in the title
# says far more about what a document is for than the same term buried in it.
_WEIGHT_TITLE = 10
_WEIGHT_TAGS = 6
_WEIGHT_DESCRIPTION = 5
_WEIGHT_PATH = 4
_WEIGHT_HEADING = 3
_WEIGHT_BODY = 1

# A term repeated throughout a long document should not outrank a term in a
# short document's title.
_MAX_BODY_HITS = 6

# Shortest stem a suffix rule may leave behind — below this, stripping does more
# conflating than matching ("user" -> "us").
_MIN_STEM = 4

# Suffix rewrites, longest first, applied repeatedly (see _stem). Chosen to make
# the pairs this corpus actually mixes up collapse together: shift/shifts,
# setting/settings, plan/planning/planner, capability/capabilities/capable,
# infeasible/infeasibility, schedule/scheduling.
_SUFFIX_RULES: tuple[tuple[str, str], ...] = (
    ("ilities", "le"),
    ("ility", "le"),
    ("ies", "y"),
    ("ied", "y"),
    ("ment", ""),
    ("ing", ""),
    ("ed", ""),
    ("er", ""),
    ("e", ""),
)

# "-es" is a plural only after a sibilant or -o ("matches", "boxes"), not after
# a vowel ("employees" -> "employee", handled by the plain "-s" rule).
_ES_PRECEDERS = frozenset("sxzho")
# "-s" that is part of the stem rather than a plural ("status", "process").
_S_PRECEDERS = frozenset("su")


def _stem(word: str) -> str:
    """Crude suffix normalisation, applied to queries and documents alike.

    Not linguistically correct and not trying to be — it only has to be
    *consistent* on both sides of the comparison, so "how do I fix an
    infeasibility" finds the page titled "Infeasible".
    """
    for _ in range(3):
        stemmed = _strip_once(word)
        if stemmed == word:
            break
        word = stemmed

    # "planning" -> "plann" -> "plan", so it meets "plan" and "planner".
    if len(word) > _MIN_STEM and word[-1] == word[-2] and word[-1] not in "aeiou":
        word = word[:-1]
    return word


def _strip_once(word: str) -> str:
    """One pass of the suffix rules; returns ``word`` unchanged if none apply.

    The table goes first: the "-ies/-ilities" rules have to see the word before
    the bare plural rule below eats its trailing "s".
    """
    for suffix, replacement in _SUFFIX_RULES:
        if word.endswith(suffix) and len(word) - len(suffix) + len(replacement) >= _MIN_STEM:
            return word[: -len(suffix)] + replacement

    if word.endswith("es") and len(word) > 2 and word[-3] in _ES_PRECEDERS:
        if len(word) - 2 >= _MIN_STEM:
            return word[:-2]
    if word.endswith("s") and not word.endswith("ss") and len(word) > 1:
        if word[-2] not in _S_PRECEDERS and len(word) - 1 >= _MIN_STEM:
            return word[:-1]
    return word


def _tokenize(text: str) -> list[str]:
    """Lowercase stemmed terms, minus stopwords and single characters."""
    return [
        _stem(word)
        for word in _WORD_RE.findall(text.lower())
        if len(word) > 1 and word not in _STOPWORDS
    ]


@dataclass
class KnowledgeDoc:
    """One Markdown file of the bundle, with its frontmatter parsed out."""

    path: str  # bundle-relative, e.g. "concepts/shift.md"
    title: str
    description: str
    doc_type: str
    tags: list[str]
    body: str  # Markdown with the frontmatter stripped
    raw: str  # the file as it is on disk, frontmatter included

    # Pre-tokenized fields, built once at load time (see _index()).
    _title_terms: list[str] = field(default_factory=list, repr=False)
    _tag_terms: list[str] = field(default_factory=list, repr=False)
    _description_terms: list[str] = field(default_factory=list, repr=False)
    _path_terms: list[str] = field(default_factory=list, repr=False)
    _heading_terms: list[str] = field(default_factory=list, repr=False)
    _body_terms: list[str] = field(default_factory=list, repr=False)

    def terms(self) -> set[str]:
        """Every distinct term this document is indexed under."""
        return {
            *self._title_terms,
            *self._tag_terms,
            *self._description_terms,
            *self._path_terms,
            *self._heading_terms,
            *self._body_terms,
        }

    def summary(self) -> dict[str, str]:
        """The catalogue entry for this document."""
        return {
            "path": self.path,
            "title": self.title,
            "type": self.doc_type,
            "description": self.description,
            "tags": ", ".join(self.tags),
        }


def _parse(path: Path, root: Path) -> KnowledgeDoc:
    """Read one bundle file into a KnowledgeDoc, frontmatter parsed if present."""
    raw = path.read_text(encoding="utf-8")

    meta: dict = {}
    body = raw
    match = _FRONTMATTER_RE.match(raw)
    if match:
        body = raw[match.end() :]
        try:
            parsed = yaml.safe_load(match.group(1))
            if isinstance(parsed, dict):
                meta = parsed
        except yaml.YAMLError:
            logger.warning("Knowledge doc %s has unparseable frontmatter", path)

    rel = path.relative_to(root).as_posix()
    tags = meta.get("tags") or []
    if isinstance(tags, str):
        tags = [t.strip() for t in tags.split(",") if t.strip()]

    return KnowledgeDoc(
        path=rel,
        # Untitled documents fall back to their filename, so they stay findable.
        title=str(meta.get("title") or path.stem.replace("-", " ").title()),
        description=str(meta.get("description") or ""),
        doc_type=str(meta.get("type") or "Document"),
        tags=[str(t) for t in tags],
        body=body,
        raw=raw,
    )


def _index(doc: KnowledgeDoc) -> None:
    """Tokenize a document's searchable fields in place."""
    doc._title_terms = _tokenize(doc.title)
    doc._tag_terms = _tokenize(" ".join(doc.tags))
    doc._description_terms = _tokenize(doc.description)
    doc._path_terms = _tokenize(doc.path.replace("/", " ").replace("-", " "))
    doc._heading_terms = _tokenize(
        " ".join(line for line in doc.body.splitlines() if line.startswith("#"))
    )
    doc._body_terms = _tokenize(doc.body)


class KnowledgeBase:
    """The OKF bundle, loaded into memory once and searched lexically.

    The documents are static (baked into the image next to the code), so the
    whole bundle is read at construction time — a few dozen small Markdown
    files — and nothing is re-read afterwards.
    """

    def __init__(self, root: str | Path) -> None:
        self.root = Path(root).expanduser().resolve()
        self.docs: list[KnowledgeDoc] = []
        self._by_path: dict[str, KnowledgeDoc] = {}
        self._idf: dict[str, float] = {}
        self._load()

    # ------------------------------------------------------------------
    # Loading
    # ------------------------------------------------------------------

    def _load(self) -> None:
        if not self.root.is_dir():
            logger.warning("Knowledge base not found at %s — tools disabled", self.root)
            return

        for path in sorted(self.root.rglob("*.md")):
            try:
                doc = _parse(path, self.root)
            except OSError as exc:
                logger.warning("Skipping knowledge doc %s: %s", path, exc)
                continue
            _index(doc)
            self.docs.append(doc)
            self._by_path[doc.path] = doc

        self._build_idf()
        logger.info("Knowledge base loaded (%s) — %d document(s)", self.root, len(self.docs))

    def _build_idf(self) -> None:
        """Weight each term by how rare it is across the bundle.

        Without this, "shift" — in the product's name, in most titles and in
        every other paragraph — would drown out the term that actually
        distinguishes one document from another. "Night shift recovery setting"
        should land on the settings reference, not on whichever page says
        "shift" most often.
        """
        total = len(self.docs)
        if not total:
            return

        doc_freq: Counter[str] = Counter()
        for doc in self.docs:
            doc_freq.update(doc.terms())

        # log(1 + N/df): a term in every document still counts (~0.69), a term
        # in one document counts about six times as much.
        self._idf = {
            term: math.log(1 + total / df) for term, df in doc_freq.items()
        }

    def _term_idf(self, term: str) -> float:
        # A term in no document at all can only come from the query; give it the
        # rarest weight rather than zero, so an exact-but-unindexed spelling
        # doesn't silently vanish.
        return self._idf.get(term, math.log(1 + len(self.docs)))

    @property
    def available(self) -> bool:
        return bool(self.docs)

    # ------------------------------------------------------------------
    # Queries
    # ------------------------------------------------------------------

    def catalogue(self) -> list[dict[str, str]]:
        """Every document's path, title, type and description."""
        return [doc.summary() for doc in self.docs]

    def search(self, query: str, limit: int = 5) -> list[dict[str, str]]:
        """Documents matching ``query``, best first, each with a snippet."""
        terms = _tokenize(query)
        if not terms:
            return []

        scored: list[tuple[float, KnowledgeDoc]] = []
        for doc in self.docs:
            score = self._score(doc, terms)
            if score:
                scored.append((score, doc))

        # Ties broken by path so repeated identical queries answer identically.
        scored.sort(key=lambda pair: (-pair[0], pair[1].path))

        results = []
        for score, doc in scored[: max(1, limit)]:
            entry = doc.summary()
            entry["score"] = f"{score:.1f}"
            entry["snippet"] = self._snippet(doc, terms)
            results.append(entry)
        return results

    def read(self, path: str) -> str:
        """One document's Markdown, frontmatter included.

        Accepts the bundle-relative paths used in the documents' own links,
        with or without the leading slash ("/concepts/shift.md").
        """
        doc = self._resolve(path)
        if doc is None:
            raise KeyError(path)
        return doc.raw

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------

    def _resolve(self, path: str) -> KnowledgeDoc | None:
        """Find a document by the many shapes a model may ask for it in."""
        candidate = (path or "").strip().lstrip("/")
        if not candidate:
            return None

        # Reject anything trying to climb out of the bundle: only the documents
        # actually indexed below are ever readable, but fail early and loudly.
        if ".." in Path(candidate).parts:
            return None

        for name in (candidate, f"{candidate}.md", f"{candidate}/index.md"):
            doc = self._by_path.get(name)
            if doc is not None:
                return doc

        # Last resort: a bare filename ("shift.md", "shift"), unambiguous only
        # if exactly one document matches.
        stem = Path(candidate).name.removesuffix(".md")
        matches = [d for d in self.docs if Path(d.path).stem == stem]
        return matches[0] if len(matches) == 1 else None

    def _score(self, doc: KnowledgeDoc, terms: list[str]) -> float:
        score = 0.0
        for term in set(terms):
            weighted = (
                _WEIGHT_TITLE * doc._title_terms.count(term)
                + _WEIGHT_TAGS * doc._tag_terms.count(term)
                + _WEIGHT_DESCRIPTION * doc._description_terms.count(term)
                + _WEIGHT_PATH * doc._path_terms.count(term)
                + _WEIGHT_HEADING * doc._heading_terms.count(term)
                + _WEIGHT_BODY * min(doc._body_terms.count(term), _MAX_BODY_HITS)
            )
            if weighted:
                score += weighted * self._term_idf(term)
        return score

    def _snippet(self, doc: KnowledgeDoc, terms: list[str], max_lines: int = 4) -> str:
        """The first few body lines mentioning any query term."""
        wanted = set(terms)
        picked: list[str] = []
        for line in doc.body.splitlines():
            stripped = line.strip()
            if not stripped or stripped.startswith("---"):
                continue
            if wanted & set(_tokenize(stripped)):
                picked.append(stripped)
                if len(picked) >= max_lines:
                    break

        if not picked:
            # Matched on frontmatter alone — the description says it better than
            # an arbitrary opening line would.
            return doc.description

        snippet = " ".join(picked)
        return snippet if len(snippet) <= 600 else snippet[:600].rstrip() + "…"


# ---------------------------------------------------------------------------
# LangChain tools
# ---------------------------------------------------------------------------


def _format_catalogue(entries: list[dict[str, str]]) -> str:
    return "\n".join(
        f"- {e['path']} — {e['title']} ({e['type']}): {e['description']}" for e in entries
    )


def build_knowledge_tools(knowledge_path: str | Path | None = None) -> list[StructuredTool]:
    """The agent's knowledge tools, or an empty list if the bundle is missing.

    Args:
        knowledge_path: bundle root. Defaults to ``settings.knowledge_path``
            (``SHIFT_AGENT_KNOWLEDGE_PATH``).
    """
    kb = KnowledgeBase(knowledge_path or settings.knowledge_path)
    if not kb.available:
        return []

    def search_knowledge(query: str, limit: int = 5) -> str:
        results = kb.search(query, limit=limit)
        if not results:
            return (
                f"No knowledge documents matched '{query}'. "
                f"Call listKnowledgeTopics to see what the bundle covers."
            )
        return "\n\n".join(
            f"## {r['title']} ({r['path']})\n"
            f"{r['description']}\n"
            f"{r['snippet']}"
            for r in results
        )

    def read_knowledge_doc(path: str) -> str:
        try:
            return kb.read(path)
        except KeyError:
            return (
                f"No knowledge document at '{path}'. "
                f"Call listKnowledgeTopics or searchKnowledge for valid paths."
            )

    def list_knowledge_topics() -> str:
        return _format_catalogue(kb.catalogue())

    return [
        StructuredTool.from_function(
            func=search_knowledge,
            name="searchKnowledge",
            description=(
                "Search the Shift Planner documentation for an explanation of how the "
                "product works — features and workflows, domain concepts, the system "
                "architecture, the solver's constraints and settings, deployment and "
                "operations. Use this for any 'how do I…', 'what is…', 'why did…' or "
                "'how does it work' question BEFORE answering from memory. Returns the "
                "best-matching documents with their bundle paths; read one in full with "
                "readKnowledgeDoc. Args: query (natural language or keywords), "
                "limit (max documents, default 5)."
            ),
        ),
        StructuredTool.from_function(
            func=read_knowledge_doc,
            name="readKnowledgeDoc",
            description=(
                "Read one Shift Planner documentation page in full, by its bundle path "
                "as returned by searchKnowledge or listKnowledgeTopics — e.g. "
                "'concepts/shift.md' or 'guide/creating-a-schedule.md'. Use it after "
                "searchKnowledge when a snippet is not enough to answer, or to follow a "
                "link from a page you already read."
            ),
        ),
        StructuredTool.from_function(
            func=list_knowledge_topics,
            name="listKnowledgeTopics",
            description=(
                "List every Shift Planner documentation page with its path, title and "
                "one-line description. Use it to see what the documentation covers when "
                "searchKnowledge finds nothing useful."
            ),
        ),
    ]
