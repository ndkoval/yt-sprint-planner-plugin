/**
 * Reads/writes the app's `scp*` extension properties on a native Sprint and maps
 * them to/from typed records. The native name/goal/start/finish live on the Sprint
 * itself and are managed via the client's sprint CRUD (§3.1); everything else is an
 * app-owned extension property.
 */
import type {
  CapacityDocument,
  CompletionCalculation,
  DataIntegrityStatus,
  FocusFactorOverride,
  FocusFactorSource,
} from '../../shared/types.js';
import {
  capacityDocumentSchema,
  completionCalculationSchema,
  focusFactorOverrideSchema,
} from '../../shared/schemas.js';
import type { YouTrackClient, YtSprint } from './youtrack-client.js';

const CURRENT_SCHEMA_VERSION = 1;

/** The app's stored state for one Sprint, decoded from extension properties. */
export interface SprintRecord {
  native: YtSprint;
  managed: boolean;
  schemaVersion: number;
  projectId: string;
  boardId: string;
  sequence: number;
  createOperationId: string | null;

  capacityRevision: number;
  capacity: CapacityDocument | null;

  focusFactor: number;
  focusFactorSource: FocusFactorSource;
  focusFactorOverride: FocusFactorOverride | null;

  rawCapacityMinutes: number;
  plannedCapacityMinutes: number;

  originalEffortMinutes: number;
  currentEffortMinutes: number;
  completedOriginalEffortMinutes: number;
  observedFocusFactor: number | null;

  excludedFromCalibration: boolean;
  calibrationSkipReason: string | null;

  metricsRevision: number;
  metricsDirty: boolean;
  dataIntegrityStatus: DataIntegrityStatus;
  lastWorkflowUpdateAt: number | null;
  lastRecalculatedAt: number | null;

  completion: CompletionCalculation | null;
}

const KEYS = [
  'scpManaged',
  'scpSchemaVersion',
  'scpProjectId',
  'scpBoardId',
  'scpSequence',
  'scpCreateOperationId',
  'scpCapacityRevision',
  'scpCapacityJson',
  'scpFocusFactor',
  'scpFocusFactorSource',
  'scpFocusFactorOverrideJson',
  'scpRawCapacityMinutes',
  'scpPlannedCapacityMinutes',
  'scpOriginalEffortMinutes',
  'scpCurrentEffortMinutes',
  'scpCompletedOriginalEffortMinutes',
  'scpObservedFocusFactor',
  'scpExcludedFromCalibration',
  'scpCalibrationSkipReason',
  'scpMetricsRevision',
  'scpMetricsDirty',
  'scpDataIntegrityStatus',
  'scpLastWorkflowUpdateAt',
  'scpLastRecalculatedAt',
  'scpCompletionCalculatedAt',
  'scpCompletionCalculationJson',
] as const;

type Raw = Record<string, string | number | boolean | null>;

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}
function str(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v : fallback;
}
function bool(v: unknown): boolean {
  return v === true;
}
function nullableNum(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
function nullableStr(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/** Parse a JSON extension property with a schema, tolerating absent/invalid values. */
function parseJson<T>(raw: unknown, parse: (v: unknown) => T): T | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  try {
    return parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

function isDataIntegrityStatus(v: unknown): v is DataIntegrityStatus {
  return (
    v === 'up-to-date' ||
    v === 'incremental' ||
    v === 'needs-recalculation' ||
    v === 'recalculating' ||
    v === 'error'
  );
}

function isFocusFactorSource(v: unknown): v is FocusFactorSource {
  return v === 'bootstrap' || v === 'calculated' || v === 'manual' || v === 'carried-forward';
}

export class SprintRepository {
  constructor(
    private readonly client: YouTrackClient,
    private readonly boardId: string,
  ) {}

  /** Hydrate a full {@link SprintRecord} for one native Sprint. */
  async load(sprint: YtSprint, projectId: string): Promise<SprintRecord> {
    const raw = (await this.client.getExtensionProperties('Sprint', sprint.id, KEYS)) as Raw;
    const source = str(raw.scpFocusFactorSource, 'bootstrap');
    return {
      native: sprint,
      managed: bool(raw.scpManaged),
      schemaVersion: num(raw.scpSchemaVersion, 0),
      projectId: str(raw.scpProjectId, projectId),
      boardId: str(raw.scpBoardId, this.boardId),
      sequence: num(raw.scpSequence, 0),
      createOperationId: nullableStr(raw.scpCreateOperationId),
      capacityRevision: num(raw.scpCapacityRevision, 0),
      capacity: parseJson<CapacityDocument>(raw.scpCapacityJson, (v) =>
        capacityDocumentSchema.parse(v),
      ),
      focusFactor: num(raw.scpFocusFactor, 0),
      focusFactorSource: isFocusFactorSource(source) ? source : 'bootstrap',
      focusFactorOverride: parseJson<FocusFactorOverride>(raw.scpFocusFactorOverrideJson, (v) =>
        focusFactorOverrideSchema.parse(v),
      ),
      rawCapacityMinutes: num(raw.scpRawCapacityMinutes, 0),
      plannedCapacityMinutes: num(raw.scpPlannedCapacityMinutes, 0),
      originalEffortMinutes: num(raw.scpOriginalEffortMinutes, 0),
      currentEffortMinutes: num(raw.scpCurrentEffortMinutes, 0),
      completedOriginalEffortMinutes: num(raw.scpCompletedOriginalEffortMinutes, 0),
      observedFocusFactor: nullableNum(raw.scpObservedFocusFactor),
      excludedFromCalibration: bool(raw.scpExcludedFromCalibration),
      calibrationSkipReason: nullableStr(raw.scpCalibrationSkipReason),
      metricsRevision: num(raw.scpMetricsRevision, 0),
      metricsDirty: bool(raw.scpMetricsDirty),
      dataIntegrityStatus: isDataIntegrityStatus(raw.scpDataIntegrityStatus)
        ? raw.scpDataIntegrityStatus
        : 'needs-recalculation',
      lastWorkflowUpdateAt: nullableNum(raw.scpLastWorkflowUpdateAt),
      lastRecalculatedAt: nullableNum(raw.scpLastRecalculatedAt),
      completion: parseJson<CompletionCalculation>(raw.scpCompletionCalculationJson, (v) =>
        completionCalculationSchema.parse(v),
      ),
    };
  }

  /** Load every managed Sprint on the board, hydrated. */
  async loadAllManaged(projectId: string): Promise<SprintRecord[]> {
    const sprints = await this.client.listSprints(this.boardId);
    const records = await Promise.all(sprints.map((s) => this.load(s, projectId)));
    return records.filter((r) => r.managed);
  }

  /** Initialise the app-owned properties for a freshly created native Sprint. */
  async initialiseProperties(
    sprintId: string,
    projectId: string,
    sequence: number,
    createOperationId: string,
    focusFactor: number,
    focusFactorSource: FocusFactorSource,
  ): Promise<void> {
    await this.client.setExtensionProperties('Sprint', sprintId, {
      scpManaged: true,
      scpSchemaVersion: CURRENT_SCHEMA_VERSION,
      scpProjectId: projectId,
      scpBoardId: this.boardId,
      scpSequence: sequence,
      scpCreateOperationId: createOperationId,
      scpFocusFactor: focusFactor,
      scpFocusFactorSource: focusFactorSource,
      scpMetricsDirty: true,
      scpDataIntegrityStatus: 'needs-recalculation',
      scpExcludedFromCalibration: false,
    });
  }

  /** Persist the capacity document and bump its revision. */
  async saveCapacity(
    sprintId: string,
    doc: CapacityDocument,
    newRevision: number,
  ): Promise<void> {
    await this.client.setExtensionProperties('Sprint', sprintId, {
      scpCapacityJson: JSON.stringify(doc),
      scpCapacityRevision: newRevision,
    });
  }

  /** Persist recomputed metrics and mark the Sprint up-to-date. */
  async saveMetrics(
    sprintId: string,
    metrics: {
      rawCapacityMinutes: number;
      plannedCapacityMinutes: number;
      originalEffortMinutes: number;
      currentEffortMinutes: number;
      completedOriginalEffortMinutes: number;
      observedFocusFactor: number | null;
      metricsRevision: number;
      status: DataIntegrityStatus;
      recalculatedAt: number;
      recalculatedBy: string | null;
      completion: CompletionCalculation | null;
    },
  ): Promise<void> {
    const values: Record<string, string | number | boolean | null> = {
      scpRawCapacityMinutes: metrics.rawCapacityMinutes,
      scpPlannedCapacityMinutes: metrics.plannedCapacityMinutes,
      scpOriginalEffortMinutes: metrics.originalEffortMinutes,
      scpCurrentEffortMinutes: metrics.currentEffortMinutes,
      scpCompletedOriginalEffortMinutes: metrics.completedOriginalEffortMinutes,
      scpObservedFocusFactor: metrics.observedFocusFactor,
      scpMetricsRevision: metrics.metricsRevision,
      scpMetricsDirty: false,
      scpDataIntegrityStatus: metrics.status,
      scpLastRecalculatedAt: metrics.recalculatedAt,
      scpLastRecalculatedBy: metrics.recalculatedBy,
      scpCompletionCalculatedAt: metrics.completion ? metrics.completion.calculatedAt : null,
      scpCompletionCalculationJson: metrics.completion
        ? JSON.stringify(metrics.completion)
        : null,
    };
    await this.client.setExtensionProperties('Sprint', sprintId, values);
  }

  /** Persist a Focus Factor value/source and optional manual-override record. */
  async saveFocusFactor(
    sprintId: string,
    value: number,
    source: FocusFactorSource,
    override: FocusFactorOverride | null,
  ): Promise<void> {
    await this.client.setExtensionProperties('Sprint', sprintId, {
      scpFocusFactor: value,
      scpFocusFactorSource: source,
      scpFocusFactorOverrideJson: override ? JSON.stringify(override) : null,
    });
  }

  /** Persist calibration exclusion state. */
  async saveCalibration(
    sprintId: string,
    excluded: boolean,
    reason: string | null,
  ): Promise<void> {
    await this.client.setExtensionProperties('Sprint', sprintId, {
      scpExcludedFromCalibration: excluded,
      scpCalibrationSkipReason: reason,
    });
  }
}
