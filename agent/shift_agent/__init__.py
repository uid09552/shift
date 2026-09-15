"""
Shift Agent — LangGraph-based conversational assistant for the Shift Planner web app.
"""

__version__ = "0.1.0"


def build_info() -> dict:
    """What is running: the version GitLab CI passed as the APP_VERSION build
    argument (see deploy/Dockerfile.*), else the package version; the commit
    and build date when the build supplied them."""
    import os

    return {
        "version": os.environ.get("APP_VERSION", "").strip() or __version__,
        "commit": os.environ.get("GIT_COMMIT", "").strip(),
        "build_date": os.environ.get("BUILD_DATE", "").strip(),
    }
