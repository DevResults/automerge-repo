import {
  AuthProvider,
  AuthenticateFn,
  AUTHENTICATION_VALID,
  DocumentId,
} from "automerge-repo"

import {
  Team,
  User,
  UserWithSecrets,
  Device,
  DeviceWithSecrets,
  Keyset,
} from "@localfirst/auth"

export class LocalFirstAuthProvider extends AuthProvider {
  #shares: Record<string, Share> = {}

  constructor({ user, device, source }: AuthProviderConfig) {
    super()
  }

  // override

  authenticate: AuthenticateFn = async (peerId, channel) => {
    return AUTHENTICATION_VALID
  }

  // custom methods

  getState = (): string => {
    throw new Error("not implemented")
  }

  createShare = (name: string): ShareId => {
    // here we would instantiate a Team
    throw "not implemented"
  }

  joinShare = ({
    shareId,
    invitationSeed,
  }: {
    shareId: ShareId
    invitationSeed: string
  }): void => {
    throw "not implemented"
  }

  members(shareId: ShareId): User[]
  members(shareId: ShareId, userId: string): User

  members(shareId: ShareId, userId?: string): User | User[] {
    // Team.members
    throw "not implemented"
  }

  addMember = (shareId: ShareId, user: User): void => {
    // Team.add
    throw "not implemented"
  }

  addDevice = (shareId: ShareId, device: Device): void => {
    throw "not implemented"
  }

  inviteMember = (shareId: ShareId): { id: string; seed: string } => {
    throw "not implemented"
  }

  inviteDevice = (shareId: ShareId): { id: string; seed: string } => {
    throw "not implemented"
  }

  addDocument({
    shareId,
    documentIds,
    roles = [],
  }: {
    shareId: ShareId
    documentIds: DocumentId[]
    roles?: RolePermissions
  }): void {
    throw "not implemented"
  }

  removeDocument({
    shareId,
    documentIds,
    roles = [],
  }: {
    shareId: ShareId
    documentIds: DocumentId[]
    roles?: RolePermissions
  }): void {
    throw "not implemented"
  }

  setRoles({ documentId, roles }: { documentId: DocumentId; roles: string[] }) {
    throw "not implemented"
  }
}

export type AuthProviderConfig = {
  user: UserWithSecrets
  device: DeviceWithSecrets
  source?: string
}

export type Share = {
  id: string
  team: Team
}

/**
 * This can be either a list of roles:
 * ```ts
 * const roles = ["ADMIN", "MANAGEMENT"]
 * ```
 * or a map of read/write roles:
 * ```ts
 * const roles = {
 *   read: ["ADMIN", "MANAGEMENT"],
 *   write: ["ADMIN"]
 * }
 * ```
 * */
export type RolePermissions = string[] | { read: string[]; write: string[] }

export type ShareId = string & { __shareId: false }
