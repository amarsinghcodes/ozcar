export type PiNoticeLevel = "error" | "info" | "success" | "warning";
export type PiResourceDiscoverReason = "reload" | "startup";
export type PiSessionStartReason = "fork" | "new" | "reload" | "resume" | "startup";
export type PiWidgetPlacement = "aboveEditor" | "belowEditor";

export interface PiTextContentLike {
  type: "text";
  text: string;
}

export interface PiUserMessageLike {
  role: "user";
  content: string | PiTextContentLike[];
}

export interface PiAssistantMessageLike {
  role: "assistant";
  content?: unknown[];
}

export interface PiToolResultMessageLike {
  role: "toolResult";
  toolName: string;
  content?: PiTextContentLike[];
  details?: unknown;
}

export interface PiCustomMessageLike {
  role: "custom";
  customType: string;
  content: string | PiTextContentLike[];
  details?: unknown;
}

export type PiMessageLike =
  | PiAssistantMessageLike
  | PiCustomMessageLike
  | PiToolResultMessageLike
  | PiUserMessageLike
  | {
      role: string;
      [key: string]: unknown;
    };

export interface PiSessionEntryBaseLike {
  id: string;
  parentId: string | null;
  timestamp: string;
  type: string;
}

export interface PiBranchSummaryEntryLike extends PiSessionEntryBaseLike {
  type: "branch_summary";
  fromId: string;
  summary: string;
}

export interface PiCustomEntryLike extends PiSessionEntryBaseLike {
  type: "custom";
  customType: string;
  data?: unknown;
}

export interface PiLabelEntryLike extends PiSessionEntryBaseLike {
  type: "label";
  label?: string;
  targetId: string;
}

export interface PiMessageEntryLike extends PiSessionEntryBaseLike {
  type: "message";
  message: PiMessageLike;
}

export type PiSessionEntryLike =
  | PiBranchSummaryEntryLike
  | PiCustomEntryLike
  | PiLabelEntryLike
  | PiMessageEntryLike
  | PiSessionEntryBaseLike;

export interface PiReadonlySessionManagerLike {
  getBranch(fromId?: string): PiSessionEntryLike[];
  getEntries(): PiSessionEntryLike[];
  getEntry(id: string): PiSessionEntryLike | undefined;
  getLeafId(): string | null;
  getLabel(id: string): string | undefined;
}

export interface PiUiLike {
  notify(message: string, level?: PiNoticeLevel): void;
  setEditorText?(text: string): void;
  setStatus?(key: string, text: string | undefined): void;
  setWidget?(
    key: string,
    content: string[] | undefined,
    options?: {
      placement?: PiWidgetPlacement;
    },
  ): void;
}

export interface PiExtensionContextLike {
  cwd: string;
  hasUI?: boolean;
  isIdle(): boolean;
  sessionManager: PiReadonlySessionManagerLike;
  ui: PiUiLike;
}

export interface PiCommandContextLike extends PiExtensionContextLike {
  navigateTree?(
    targetId: string,
    options?: {
      customInstructions?: string;
      label?: string;
      replaceInstructions?: boolean;
      summarize?: boolean;
    },
  ): Promise<{ cancelled: boolean }>;
  reload?(): Promise<void>;
}

export interface PiResourceDiscoverEventLike {
  cwd: string;
  reason: PiResourceDiscoverReason;
}

export interface PiSessionStartEventLike {
  previousSessionFile?: string;
  reason: PiSessionStartReason;
  type: "session_start";
}

export interface PiSessionBeforeTreeEventLike {
  preparation: {
    commonAncestorId: string | null;
    customInstructions?: string;
    entriesToSummarize: PiSessionEntryLike[];
    label?: string;
    oldLeafId: string | null;
    replaceInstructions?: boolean;
    targetId: string;
    userWantsSummary: boolean;
  };
  signal?: AbortSignal;
  type: "session_before_tree";
}

export interface PiSessionBeforeTreeResultLike {
  cancel?: boolean;
  customInstructions?: string;
  label?: string;
  replaceInstructions?: boolean;
  summary?: {
    details?: unknown;
    summary: string;
  };
}

export interface PiSessionTreeEventLike {
  fromExtension?: boolean;
  newLeafId: string | null;
  oldLeafId: string | null;
  summaryEntry?: PiBranchSummaryEntryLike;
  type: "session_tree";
}

export interface PiResourceDiscoveryLike {
  promptPaths?: string[];
  skillPaths?: string[];
  themePaths?: string[];
}

export interface PiCommandRegistrationLike {
  description: string;
  handler: (args: string, ctx: PiCommandContextLike) => Promise<void> | void;
}

export interface PiToolResultLike<TDetails = unknown> {
  content: PiTextContentLike[];
  details?: TDetails;
}

export interface PiToolDefinitionLike<TParams = Record<string, unknown>, TDetails = unknown> {
  description: string;
  execute: (
    toolCallId: string,
    params: TParams,
    signal: AbortSignal | undefined,
    onUpdate: unknown,
    ctx: PiExtensionContextLike,
  ) => Promise<PiToolResultLike<TDetails>> | PiToolResultLike<TDetails>;
  label: string;
  name: string;
  parameters: unknown;
}

export interface PiExtensionApiLike {
  appendEntry<T = unknown>(customType: string, data?: T): void;
  on(
    event: "resources_discover",
    handler: (
      event: PiResourceDiscoverEventLike,
      ctx: PiExtensionContextLike,
    ) => Promise<PiResourceDiscoveryLike> | PiResourceDiscoveryLike,
  ): void;
  on(
    event: "session_before_tree",
    handler: (
      event: PiSessionBeforeTreeEventLike,
      ctx: PiExtensionContextLike,
    ) => Promise<PiSessionBeforeTreeResultLike | void> | PiSessionBeforeTreeResultLike | void,
  ): void;
  on(
    event: "session_start",
    handler: (event: PiSessionStartEventLike, ctx: PiExtensionContextLike) => Promise<void> | void,
  ): void;
  on(
    event: "session_tree",
    handler: (event: PiSessionTreeEventLike, ctx: PiExtensionContextLike) => Promise<void> | void,
  ): void;
  registerCommand(name: string, options: PiCommandRegistrationLike): void;
  registerTool<TParams = Record<string, unknown>, TDetails = unknown>(
    tool: PiToolDefinitionLike<TParams, TDetails>,
  ): void;
  setLabel(entryId: string, label: string | undefined): void;
  setSessionName(name: string): void;
}
