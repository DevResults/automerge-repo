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
  createTeam,
  LocalUserContext,
} from "@localfirst/auth"

export class LocalFirstAuthProvider extends AuthProvider {
  #shares: Record<string, Share> = {}
  #userContext: LocalUserContext

  constructor({ user, device, source }: AuthProviderConfig) {
    super()
    this.#userContext = { user, device }
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
    const team = createTeam(name, this.#userContext)
    const teamShare = { id: name, team: team } as Share
    this.#shares = { teamShare }
    return this.getShare(name as ShareId).id as ShareId
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

  addMember = (shareId: ShareId, user: UserWithSecrets): void => {
    const share = this.getShare(shareId)
    share.team.add(user, [])
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
  private getShare(name: ShareId) {
    return (Object.values(this.#shares) as Array<Share>).find(
      key => key.id === name.toString()
    )
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
