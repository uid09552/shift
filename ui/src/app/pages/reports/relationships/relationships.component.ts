import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  ViewChild,
  ViewEncapsulation,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { Subscription, forkJoin, of } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';
import { drag } from 'd3-drag';
import {
  Simulation,
  SimulationLinkDatum,
  SimulationNodeDatum,
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
} from 'd3-force';
import { Selection, select } from 'd3-selection';
import { ZoomBehavior, zoom, zoomIdentity } from 'd3-zoom';
import { PageBreadcrumbComponent } from '../../../shared/components/common/page-breadcrumb/page-breadcrumb.component';
import { LoadErrorComponent } from '../../../shared/components/ui/load-error/load-error.component';
import { TranslatePipe } from '../../../shared/i18n/translate.pipe';
import { TranslationService } from '../../../shared/i18n/translation.service';
import { CapabilityService } from '../../../shared/services/capability.service';
import { ConfirmedShiftPlanService } from '../../../shared/services/confirmed-shift-plan.service';
import { EmployeeService } from '../../../shared/services/employee.service';
import { ShiftService } from '../../../shared/services/shift.service';
import { WorkstationService } from '../../../shared/services/workstation.service';
import {
  Graph,
  GraphInput,
  GraphLink,
  GraphNode,
  LINK_TYPES,
  LinkType,
  NODE_TYPES,
  NodeType,
  RosterEntry,
  applyFilters,
  buildGraph,
  endId,
  neighbourhood,
} from './relationship-graph';

type SimNode = GraphNode & SimulationNodeDatum;
type SimLink = Omit<GraphLink, 'source' | 'target'> & SimulationLinkDatum<SimNode>;

/** Rest length of a link: tight for qualifications, looser for shifts. */
const LINK_DISTANCE: Record<LinkType, number> = {
  hasCapability: 55,
  requires: 65,
  mayWork: 85,
  runs: 85,
  assigned: 75,
};

/** Outline of each node type, centred on 0,0 — circle, diamond, square, hexagon. */
const SHAPE: Record<NodeType, string> = {
  employee: 'M -7 0 A 7 7 0 1 0 7 0 A 7 7 0 1 0 -7 0 Z',
  capability: 'M 0 -9 L 9 0 L 0 9 L -9 0 Z',
  workstation: 'M -7.5 -7.5 H 7.5 V 7.5 H -7.5 Z',
  shift: 'M 8 0 L 4 6.9 L -4 6.9 L -8 0 L -4 -6.9 L 4 -6.9 Z',
};

/**
 * Who can work where: employees, capabilities, workstations and shifts as one
 * force-directed network, with the confirmed roster of a day or a week on top
 * when asked for. Read-only — dragging pins a node on screen and nothing else.
 */
@Component({
  selector: 'app-relationships',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, PageBreadcrumbComponent, LoadErrorComponent, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.Eager,
  // d3 creates the SVG elements outside Angular's templates; the stylesheet
  // scopes itself to the host class `rel` instead.
  encapsulation: ViewEncapsulation.None,
  host: { class: 'rel' },
  styleUrl: './relationships.component.css',
  template: `
    <app-page-breadcrumb pageTitle="nav.relationships" />

    <div class="table-card relationships-card" data-testid="relationships-page">
      <div class="flex flex-wrap items-start justify-between gap-3 border-b border-gray-100 px-5 py-4 dark:border-white/[0.05]">
        <div class="min-w-0">
          <h3 class="text-lg font-semibold tracking-tight text-gray-800 dark:text-white/90">{{ 'relationships.heading' | t }}</h3>
          <p class="mt-0.5 max-w-2xl text-sm text-gray-500 dark:text-gray-400">{{ 'relationships.intro' | t }}</p>
        </div>
        <button
          type="button"
          (click)="resetLayout()"
          [disabled]="!graph"
          data-testid="relationships-reset"
          class="rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 focus-visible:ring-2 focus-visible:ring-brand-500 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/[0.03]"
        >{{ 'relationships.reset' | t }}</button>
      </div>

      <!-- Toolbar: what to show, search, roster layer -->
      <div class="flex flex-wrap items-center gap-x-5 gap-y-3 border-b border-gray-100 px-5 py-3 dark:border-white/[0.05]">
        <div class="flex flex-wrap items-center gap-1.5" role="group" [attr.aria-label]="'relationships.show' | t">
          <span class="mr-1 text-xs text-gray-500 dark:text-gray-400">{{ 'relationships.show' | t }}</span>
          @for (type of nodeTypes; track type) {
            <button
              type="button"
              (click)="toggleNodeType(type)"
              [attr.aria-pressed]="shown.has(type)"
              [attr.data-testid]="'relationships-toggle-' + type"
              class="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-brand-500"
              [ngClass]="shown.has(type)
                ? 'border-gray-300 bg-gray-100 text-gray-800 dark:border-gray-600 dark:bg-gray-700 dark:text-white'
                : 'border-gray-200 text-gray-400 hover:text-gray-600 dark:border-gray-700 dark:text-gray-500 dark:hover:text-gray-300'"
            >
              <svg width="12" height="12" viewBox="-10 -10 20 20" aria-hidden="true"><path [attr.d]="shape[type]" [attr.class]="'swatch swatch-' + type" /></svg>
              {{ 'relationships.type.' + type | t }}
            </button>
          }
        </div>

        <label class="relative flex items-center">
          <span class="sr-only">{{ 'relationships.search' | t }}</span>
          <input
            type="search"
            [(ngModel)]="search"
            (ngModelChange)="render()"
            [placeholder]="'relationships.search' | t"
            data-testid="relationships-search"
            class="h-8 w-48 rounded-lg border border-gray-200 bg-transparent px-3 text-sm text-gray-700 placeholder:text-gray-400 focus:border-brand-300 focus:ring-2 focus:ring-brand-500/20 dark:border-gray-700 dark:text-gray-300"
          />
        </label>

        <div class="flex flex-wrap items-center gap-2">
          <label class="inline-flex cursor-pointer items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <input type="checkbox" [(ngModel)]="layerOn" (ngModelChange)="loadRoster()" data-testid="relationships-layer"
              class="h-4 w-4 rounded border-gray-300 text-brand-500 focus:ring-brand-500 dark:border-gray-600" />
            {{ 'relationships.layer' | t }}
          </label>
          @if (layerOn) {
            <div class="flex items-center rounded-lg border border-gray-200 p-0.5 dark:border-gray-700" role="group">
              @for (mode of layerModes; track mode) {
                <button
                  type="button"
                  (click)="setLayerMode(mode)"
                  [attr.aria-pressed]="layerMode === mode"
                  [attr.data-testid]="'relationships-layer-' + mode"
                  class="rounded-md px-2.5 py-1 text-xs font-medium transition-colors"
                  [ngClass]="layerMode === mode
                    ? 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-white'
                    : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'"
                >{{ 'relationships.layer.' + mode | t }}</button>
              }
            </div>
            <input type="date" [(ngModel)]="layerDate" (ngModelChange)="loadRoster()" data-testid="relationships-date"
              class="h-8 rounded-lg border border-gray-200 bg-transparent px-2 text-sm text-gray-700 dark:border-gray-700 dark:text-gray-300 dark:[color-scheme:dark]" />
            <span class="text-sm tabular-nums text-gray-500 dark:text-gray-400">{{ periodLabel }}</span>
          }
        </div>
      </div>

      @if (partial.length) {
        <p class="border-b border-gray-100 bg-warning-50 px-5 py-2 text-sm text-warning-700 dark:border-white/[0.05] dark:bg-warning-500/10 dark:text-warning-400">
          {{ 'relationships.partial' | t: { names: partial.join(', ') } }}
        </p>
      }

      @if (error) {
        <app-load-error [message]="error | t" (retry)="load()" />
      } @else if (!graph) {
        <p class="px-5 py-12 text-center text-sm text-gray-400 dark:text-gray-500">{{ 'relationships.loading' | t }}</p>
      } @else if (!graph.nodes.length) {
        <div class="px-5 py-12 text-center" data-testid="relationships-empty">
          <p class="text-sm text-gray-500 dark:text-gray-400">{{ 'relationships.empty' | t }}</p>
          <p class="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-1 text-sm">
            <a routerLink="/user-profiles" class="text-brand-500 hover:underline">{{ 'nav.userProfiles' | t }}</a>
            <a routerLink="/capabilities" class="text-brand-500 hover:underline">{{ 'nav.capabilities' | t }}</a>
            <a routerLink="/workstations" class="text-brand-500 hover:underline">{{ 'nav.workstations' | t }}</a>
            <a routerLink="/shifts" class="text-brand-500 hover:underline">{{ 'nav.shifts' | t }}</a>
          </p>
        </div>
      }

      <div class="relationships-body" [hidden]="!graph || !graph.nodes.length">
        <div class="relationships-canvas" #canvas data-testid="relationships-canvas"></div>

        <!-- Legend: shapes and line styles -->
        <div class="relationships-legend" data-testid="relationships-legend" [attr.aria-label]="'relationships.legend' | t">
          @for (type of nodeTypes; track type) {
            <span class="flex items-center gap-1.5">
              <svg width="12" height="12" viewBox="-10 -10 20 20" aria-hidden="true"><path [attr.d]="shape[type]" [attr.class]="'swatch swatch-' + type" /></svg>
              {{ 'relationships.type.' + type | t }}
            </span>
          }
          <span class="flex items-center gap-1.5"><svg width="22" height="6" aria-hidden="true"><line x1="0" y1="3" x2="22" y2="3" class="legend-link" /></svg>{{ 'relationships.edge.hasCapability' | t }} · {{ 'relationships.edge.runs' | t }}</span>
          @if (layerOn) {
            <span class="flex items-center gap-1.5"><svg width="22" height="6" aria-hidden="true"><line x1="0" y1="3" x2="22" y2="3" class="legend-link assigned" /></svg>{{ 'relationships.edge.assigned' | t }}</span>
            <span class="flex items-center gap-1.5"><svg width="22" height="6" aria-hidden="true"><line x1="0" y1="3" x2="22" y2="3" class="legend-link assigned uncovered" /></svg>{{ 'relationships.edge.uncovered' | t }}</span>
          }
          <span class="flex items-center gap-1.5"><svg width="14" height="14" viewBox="-10 -10 20 20" aria-hidden="true"><circle r="8.5" class="legend-spof" /></svg>{{ 'relationships.spof' | t }}</span>
        </div>

        <!-- Selected node -->
        <aside class="relationships-panel" data-testid="relationships-panel" aria-live="polite">
          @if (selected; as node) {
            <p class="text-xs text-gray-500 dark:text-gray-400">{{ 'relationships.type.' + node.type | t }}</p>
            <h4 class="mt-0.5 text-base font-semibold tracking-tight text-gray-800 dark:text-white/90">{{ node.name }}</h4>
            <div class="mt-2 space-y-1 text-xs">
              @if (node.closed) { <p class="text-gray-500 dark:text-gray-400">{{ 'relationships.closed' | t }}</p> }
              @if (node.spof) { <p class="text-warning-700 dark:text-warning-400">{{ 'relationships.spof' | t }}</p> }
              @if (isPinned(node.id)) { <p class="text-gray-500 dark:text-gray-400">{{ 'relationships.pinned' | t }}</p> }
            </div>
            <p class="mt-4 text-xs text-gray-500 tabular-nums dark:text-gray-400">{{ 'relationships.connections' | t: { count: connections.length } }}</p>
            <ul class="mt-2 space-y-1 text-sm">
              @for (c of connections; track c.id) {
                <li class="flex items-center justify-between gap-2">
                  <button type="button" (click)="selectNode(c.node.id)" class="min-w-0 truncate text-left text-gray-700 hover:text-brand-500 dark:text-gray-300">
                    {{ c.node.name }}
                  </button>
                  <span class="shrink-0 text-xs text-gray-400 tabular-nums" [class.text-warning-700]="c.uncovered">
                    @if (c.days) { {{ 'relationships.days' | t: { count: c.days } }} } @else { {{ 'relationships.edge.' + c.type | t }} }
                  </span>
                </li>
              }
            </ul>
          } @else {
            <p class="text-sm text-gray-400 dark:text-gray-500">{{ 'relationships.hint' | t }}</p>
          }
        </aside>
      </div>
    </div>
  `,
})
export class RelationshipsComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('canvas', { static: true }) canvas!: ElementRef<HTMLDivElement>;

  readonly nodeTypes = NODE_TYPES;
  readonly layerModes = ['day', 'week'] as const;
  readonly shape = SHAPE;

  input: GraphInput | null = null;
  graph: Graph | null = null;
  error: string | null = null;
  /** Workstations whose required capabilities could not be loaded. */
  partial: string[] = [];

  /** Shifts start hidden: they connect to nearly everything. */
  shown = new Set<NodeType>(['employee', 'capability', 'workstation']);
  search = '';
  layerOn = false;
  layerMode: 'day' | 'week' = 'week';
  layerDate = isoDate(new Date());
  private roster: RosterEntry[] | null = null;

  selected: SimNode | null = null;
  connections: { id: string; node: SimNode; type: LinkType; days?: number; uncovered?: boolean }[] = [];
  private hovered: string | null = null;

  private simulation?: Simulation<SimNode, SimLink>;
  private zoomBehaviour?: ZoomBehavior<SVGSVGElement, unknown>;
  private svg?: Selection<SVGSVGElement, unknown, null, undefined>;
  private layer?: Selection<SVGGElement, unknown, null, undefined>;
  /** Positions survive re-renders (filters, roster), so the picture does not jump. */
  private positions = new Map<string, { x?: number; y?: number; fx?: number | null; fy?: number | null }>();
  private nodes: SimNode[] = [];
  private links: SimLink[] = [];
  private loadSub?: Subscription;
  private rosterSub?: Subscription;
  private resizeObserver?: ResizeObserver;

  constructor(
    private employees: EmployeeService,
    private shifts: ShiftService,
    private capabilities: CapabilityService,
    private workstations: WorkstationService,
    private plans: ConfirmedShiftPlanService,
    private translations: TranslationService,
    private cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.load();
  }

  ngAfterViewInit(): void {
    const host = this.canvas.nativeElement;
    this.svg = select(host).append('svg').attr('class', 'relationships-svg').attr('data-testid', 'relationships-svg');
    this.layer = this.svg.append('g');
    this.layer.append('g').attr('class', 'links');
    this.layer.append('g').attr('class', 'link-labels');
    this.layer.append('g').attr('class', 'nodes');
    this.zoomBehaviour = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.2, 4])
      .on('zoom', (event) => this.layer!.attr('transform', event.transform.toString()));
    // Double-click releases a pinned node, so it must not also zoom.
    this.svg.call(this.zoomBehaviour).on('dblclick.zoom', null);
    this.svg.on('click', (event: MouseEvent) => {
      if (event.target === this.svg!.node()) this.selectNode(null);
    });
    this.resizeObserver = new ResizeObserver(() => this.recentre());
    this.resizeObserver.observe(host);
    if (this.graph) this.render();
  }

  ngOnDestroy(): void {
    this.simulation?.stop();
    this.resizeObserver?.disconnect();
    this.loadSub?.unsubscribe();
    this.rosterSub?.unsubscribe();
  }

  /** Configuration first; each workstation's requirements in parallel, a failure costing only that one. */
  load(): void {
    this.error = null;
    this.graph = null;
    this.partial = [];
    this.loadSub?.unsubscribe();
    this.loadSub = forkJoin({
      employees: this.employees.getEmployeeProfiles(1000, 0).pipe(map((r) => r.data)),
      shifts: this.shifts.getShifts(),
      capabilities: this.capabilities.getCapabilities(),
      workstations: this.workstations.getWorkstations(),
    })
      .pipe(
        switchMap((base) => {
          const failed: string[] = [];
          const requirements = base.workstations.map((w) =>
            this.workstations.getRequiredCapabilities(w.id).pipe(
              map((caps) => [w.id, caps.map((c) => c.id)] as const),
              catchError(() => {
                failed.push(w.name);
                return of([w.id, [] as string[]] as const);
              }),
            ),
          );
          return (requirements.length ? forkJoin(requirements) : of([])).pipe(
            map((pairs) => ({ base, required: Object.fromEntries(pairs), failed })),
          );
        }),
      )
      .subscribe({
        next: ({ base, required, failed }) => {
          this.input = { ...base, requiredCapabilities: required };
          this.partial = failed;
          this.rebuild();
        },
        error: () => {
          this.error = 'relationships.failed';
          this.cdr.markForCheck();
        },
      });
  }

  /** The confirmed roster of the chosen day or week — only while the layer is on. */
  loadRoster(): void {
    this.rosterSub?.unsubscribe();
    if (!this.layerOn || !this.layerDate) {
      this.roster = null;
      this.rebuild();
      return;
    }
    const { from, to, days } = this.period;
    const limit = Math.max(500, (this.input?.employees.length ?? 0) * days);
    this.rosterSub = this.plans.getConfirmedShiftPlans(from, to, limit, 0).subscribe({
      next: (r) => {
        this.roster = r.data;
        this.rebuild();
      },
      error: () => {
        this.roster = null;
        this.error = 'relationships.failed';
        this.cdr.markForCheck();
      },
    });
  }

  setLayerMode(mode: 'day' | 'week'): void {
    if (this.layerMode === mode) return;
    this.layerMode = mode;
    this.loadRoster();
  }

  toggleNodeType(type: NodeType): void {
    if (this.shown.has(type)) this.shown.delete(type);
    else this.shown.add(type);
    this.render();
  }

  /** Monday to Sunday around the chosen date, or that day alone. */
  get period(): { from: string; to: string; days: number } {
    const day = new Date(`${this.layerDate}T00:00:00`);
    if (this.layerMode === 'day') return { from: this.layerDate, to: this.layerDate, days: 1 };
    const monday = new Date(day);
    monday.setDate(day.getDate() - ((day.getDay() + 6) % 7));
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    return { from: isoDate(monday), to: isoDate(sunday), days: 7 };
  }

  get periodLabel(): string {
    const { from, to } = this.period;
    const locale = this.translations.language() === 'de' ? 'de-DE' : 'en-GB';
    const fmt = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString(locale, { day: 'numeric', month: 'short' });
    return from === to ? fmt(from) : `${fmt(from)} – ${fmt(to)}`;
  }

  isPinned(id: string): boolean {
    const n = this.nodes.find((node) => node.id === id);
    return n?.fx != null;
  }

  selectNode(id: string | null): void {
    this.selected = id ? this.nodes.find((n) => n.id === id) ?? null : null;
    this.updateConnections();
    this.applyHighlight();
    this.cdr.markForCheck();
  }

  /** Unpins every node, recentres the view and lets the layout run again. */
  resetLayout(): void {
    this.positions.clear();
    for (const n of this.nodes) {
      n.fx = null;
      n.fy = null;
    }
    if (this.svg && this.zoomBehaviour) this.svg.call(this.zoomBehaviour.transform, zoomIdentity);
    this.recentre();
    this.simulation?.alpha(1).restart();
    this.cdr.markForCheck();
  }

  private rebuild(): void {
    if (!this.input) return;
    this.graph = buildGraph(this.input, this.layerOn ? this.roster : null);
    this.cdr.markForCheck();
    this.render();
  }

  /** Draws what the filters leave visible, keeping known nodes where they were. */
  render(): void {
    if (!this.graph || !this.layer) return;
    for (const n of this.nodes) this.positions.set(n.id, { x: n.x, y: n.y, fx: n.fx, fy: n.fy });

    const filtered = applyFilters(this.graph, {
      nodeTypes: this.shown,
      linkTypes: new Set(LINK_TYPES.filter((t) => t !== 'assigned' || this.layerOn)),
      search: this.search,
    });
    this.nodes = filtered.nodes.map((n) => ({ ...n, ...this.positions.get(n.id) }));
    this.links = filtered.links.map((l) => ({ ...l }));
    this.searchHits = filtered.highlighted;

    const { width, height } = this.size();
    this.simulation?.stop();
    this.simulation = forceSimulation<SimNode, SimLink>(this.nodes)
      .force('link', forceLink<SimNode, SimLink>(this.links).id((n) => n.id).distance((l) => LINK_DISTANCE[l.type]))
      // Weaker repulsion on large tenants keeps the layout from flying apart.
      .force('charge', forceManyBody<SimNode>().strength(-Math.max(40, 220 - this.nodes.length / 3)))
      .force('center', forceCenter(width / 2, height / 2))
      .force('collide', forceCollide<SimNode>(14))
      // A known picture settles quietly; a new one gets a full run.
      .alpha(this.positions.size ? 0.3 : 1);

    const linkSel = this.layer
      .select<SVGGElement>('g.links')
      .selectAll<SVGLineElement, SimLink>('line')
      .data(this.links, (l) => l.id)
      .join('line')
      .attr('class', (l) => `link link-${l.type}${l.uncovered ? ' uncovered' : ''}`)
      .attr('stroke-width', (l) => (l.days ? 1.5 + Math.min(l.days, 7) * 0.4 : 1));

    const labelSel = this.layer
      .select<SVGGElement>('g.link-labels')
      .selectAll<SVGTextElement, SimLink>('text')
      .data(this.links.filter((l) => l.days), (l) => l.id)
      .join('text')
      .attr('class', (l) => `link-label${l.uncovered ? ' uncovered' : ''}`)
      .text((l) => String(l.days));

    const nodeSel = this.layer
      .select<SVGGElement>('g.nodes')
      .selectAll<SVGGElement, SimNode>('g.node')
      .data(this.nodes, (n) => n.id)
      .join((enter) => {
        const g = enter.append('g').attr('tabindex', 0).attr('role', 'button');
        g.append('circle').attr('class', 'spof-ring').attr('r', 12);
        g.append('path').attr('class', 'shape');
        g.append('text').attr('class', 'node-label').attr('x', 12).attr('dy', '0.32em');
        return g;
      })
      .attr('class', (n) => `node node-${n.type}${n.closed ? ' closed' : ''}${n.spof ? ' spof' : ''}${n.fx != null ? ' pinned' : ''}`)
      .attr('data-testid', (n) => `relationships-node-${n.id}`)
      .attr('aria-label', (n) => `${this.translations.t('relationships.type.' + n.type)}: ${n.name}`);
    nodeSel.select<SVGPathElement>('path.shape')
      .attr('d', (n) => SHAPE[n.type])
      .style('fill', (n) => (n.type === 'shift' && n.color ? n.color : null));
    nodeSel.select<SVGTextElement>('text.node-label').text((n) => n.name);

    nodeSel
      .on('mouseenter', (_e, n) => {
        this.hovered = n.id;
        this.applyHighlight();
      })
      .on('mouseleave', () => {
        this.hovered = null;
        this.applyHighlight();
      })
      .on('click', (event: MouseEvent, n) => {
        event.stopPropagation();
        this.selectNode(n.id);
      })
      .on('keydown', (event: KeyboardEvent, n) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          this.selectNode(n.id);
        }
      })
      // Release a pinned node.
      .on('dblclick', (event: MouseEvent, n) => {
        event.stopPropagation();
        n.fx = null;
        n.fy = null;
        this.markPinned();
        this.simulation?.alphaTarget(0).alpha(0.3).restart();
      })
      .call(
        drag<SVGGElement, SimNode>()
          .on('start', (event, n) => {
            if (!event.active) this.simulation?.alphaTarget(0.3).restart();
            n.fx = n.x;
            n.fy = n.y;
          })
          .on('drag', (event, n) => {
            n.fx = event.x;
            n.fy = event.y;
          })
          // Pinned where it was dropped: fx/fy stay until a double-click.
          .on('end', (event) => {
            if (!event.active) this.simulation?.alphaTarget(0);
            this.markPinned();
          }),
      );

    this.simulation.on('tick', () => {
      linkSel
        .attr('x1', (l) => (l.source as SimNode).x!)
        .attr('y1', (l) => (l.source as SimNode).y!)
        .attr('x2', (l) => (l.target as SimNode).x!)
        .attr('y2', (l) => (l.target as SimNode).y!);
      labelSel
        .attr('x', (l) => ((l.source as SimNode).x! + (l.target as SimNode).x!) / 2)
        .attr('y', (l) => ((l.source as SimNode).y! + (l.target as SimNode).y!) / 2);
      nodeSel.attr('transform', (n) => `translate(${n.x},${n.y})`);
    });

    // A selection that is no longer visible is dropped.
    if (this.selected && !this.nodes.some((n) => n.id === this.selected!.id)) this.selected = null;
    else if (this.selected) this.selected = this.nodes.find((n) => n.id === this.selected!.id)!;
    this.updateConnections();
    this.applyHighlight();
  }

  private searchHits: Set<string> | null = null;

  /** Hover beats selection beats search; everything outside the focus is dimmed. */
  private applyHighlight(): void {
    if (!this.layer) return;
    const focusId = this.hovered ?? this.selected?.id ?? null;
    const focus = focusId ? neighbourhood(this.links as unknown as GraphLink[], focusId) : this.searchHits;
    this.layer.selectAll<SVGGElement, SimNode>('g.node')
      .classed('dim', (n) => !!focus && !focus.has(n.id))
      .classed('selected', (n) => n.id === this.selected?.id);
    this.layer.selectAll<SVGLineElement, SimLink>('line.link').classed('dim', (l) => {
      if (!focus) return false;
      const s = endId(l.source as SimNode);
      const t = endId(l.target as SimNode);
      return focusId ? s !== focusId && t !== focusId : !(focus.has(s) && focus.has(t));
    });
    this.layer.selectAll<SVGTextElement, SimLink>('text.link-label').classed('dim', (l) => {
      if (!focusId) return !!focus;
      return endId(l.source as SimNode) !== focusId && endId(l.target as SimNode) !== focusId;
    });
  }

  private updateConnections(): void {
    const id = this.selected?.id;
    if (!id) {
      this.connections = [];
      return;
    }
    const byId = new Map(this.nodes.map((n) => [n.id, n]));
    this.connections = this.links
      .filter((l) => endId(l.source as SimNode) === id || endId(l.target as SimNode) === id)
      .map((l) => {
        const other = endId(l.source as SimNode) === id ? endId(l.target as SimNode) : endId(l.source as SimNode);
        return { id: l.id, node: byId.get(other)!, type: l.type, days: l.days, uncovered: l.uncovered };
      })
      .filter((c) => c.node)
      .sort((a, b) => a.node.type.localeCompare(b.node.type) || a.node.name.localeCompare(b.node.name));
  }

  private markPinned(): void {
    this.layer?.selectAll<SVGGElement, SimNode>('g.node').classed('pinned', (n) => n.fx != null);
    this.cdr.markForCheck();
  }

  private size(): { width: number; height: number } {
    const el = this.canvas.nativeElement;
    return { width: el.clientWidth || 800, height: el.clientHeight || 500 };
  }

  private recentre(): void {
    if (!this.simulation || !this.svg) return;
    const { width, height } = this.size();
    this.svg.attr('viewBox', `0 0 ${width} ${height}`);
    this.simulation.force('center', forceCenter(width / 2, height / 2));
    this.simulation.alpha(Math.max(this.simulation.alpha(), 0.1)).restart();
  }
}

function isoDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
