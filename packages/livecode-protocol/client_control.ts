/**
 * Client-control wire types: the `/client/command` HTTP surface and the
 * envelope/result messages carried over the `/client/control` socket.
 */

import type {
  AddProjectModuleRequest,
  ProjectModuleLocator,
} from "./project.ts";

export interface ClientControlTarget {
  clientId?: string;
}

export type ClientControlCommand =
  | { type: "getState" }
  | { type: "openProject"; projectPath: string; connect?: boolean }
  | ({ type: "runModule"; replaceRunning?: boolean } & ProjectModuleLocator)
  | ({ type: "stopModule" } & ProjectModuleLocator)
  | { type: "stopAllModules" }
  | ({ type: "setModuleSource"; sourceText: string } & ProjectModuleLocator)
  | { type: "addProjectModule"; module: AddProjectModuleRequest }
  | ({ type: "reloadProjectModule" } & ProjectModuleLocator);

export interface ClientControlRequest extends ClientControlTarget {
  command: ClientControlCommand;
  timeoutMs?: number;
}

export interface ClientControlEnvelope {
  type: "clientCommand";
  commandId: string;
  command: ClientControlCommand;
}

export interface ClientControlResultMessage {
  type: "clientCommandResult";
  commandId: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

export interface ClientControlCommandResponse {
  ok: boolean;
  commandId: string;
  clientId: string;
  result?: unknown;
  error?: string;
}

export interface ClientControlClientsResponse {
  ok: true;
  clients: Array<{
    clientId: string;
    connectedAt: number;
  }>;
}
