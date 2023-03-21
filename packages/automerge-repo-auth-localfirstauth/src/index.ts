import {
  AuthenticateFn,
  AUTHENTICATION_VALID,
  AuthProvider,
  DocumentId,
} from "automerge-repo"

import { v4 as uuid } from "uuid"

import {
  createTeam,
  Device,
  DeviceWithSecrets,
  LocalUserContext,
  Member,
  Team,
  UserWithSecrets,
} from "@localfirst/auth"

export class LocalFirstAuthProvider extends AuthProvider {
  #shares: Record<string, Share> = {}
  #userContext: LocalUserContext
  #idGenerator: IdGenerator

  constructor({
    user,
    device,
    source,
    idGenerator = uuid as IdGenerator,
  }: AuthProviderConfig) {
    super()
    this.#userContext = { user, device }
    this.#idGenerator = idGenerator
    if (source) {
      this.#shares = JSON.parse(source)
    }
  }

  // override

  authenticate: AuthenticateFn = async (peerId, channel) => {
    // TODO
    return AUTHENTICATION_VALID
  }

  // custom methods

  getState = (): string => {
    return JSON.stringify(this.#shares)
  }

  createShare = (name: string): ShareId => {
    const id = this.#idGenerator()
    const team = createTeam(name, this.#userContext)
    const share = { id, team, permissions: {} } as Share
    this.#shares.id = share
    return id
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

  members(shareId: ShareId): Member[]
  members(shareId: ShareId, userId: string): Member

  members(shareId: ShareId, userId?: string): Member | Member[] {
    const { team } = this.getShare(shareId)
    return team.members(userId)
  }

  addMember = (shareId: ShareId, user: Member): void => {
    throw "not implemented"
  }

  addDevice = (shareId: ShareId, device: Device): void => {
    throw "not implemented"
  }

  inviteMember = (shareId: ShareId): { id: string; seed: string } => {
    const team = this.getShare(shareId).team
    const { id, seed } = team.inviteMember()
    return { id, seed }
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
    const share = this.getShare(shareId)
    documentIds.forEach(id => {
      share.permissions[id] = roles
    })
  }

  removeDocument({
    shareId,
    documentIds,
  }: {
    shareId: ShareId
    documentIds: DocumentId[]
  }): void {
    const share = this.getShare(shareId)
    documentIds.forEach(id => {
      delete share.permissions[id]
    })
  }

  setRoles({
    shareId,
    documentId,
    roles,
  }: {
    shareId: ShareId
    documentId: DocumentId
    roles: string[]
  }) {
    const share = this.getShare(shareId)
    share.permissions[documentId] = roles
  }

  private getShare(id: ShareId) {
    return this.#shares[id]
  }
}

export type AuthProviderConfig = {
  user: UserWithSecrets
  device: DeviceWithSecrets
  source?: string
  idGenerator?: IdGenerator
}

export type Share = {
  id: string
  team: Team
  permissions: Record<DocumentId, RolePermissions>
}

/**
 * This can be either a list of roles:
 * ```ts
 * const roles = ["ADMIN", "MANAGEMENT"]
 * ```
 * or a map of read/write roles:
 * ```ts
 * const roles = { read: ["ADMIN", "MANAGEMENT"], write: ["ADMIN"] }
 * ```
 * */
export type RolePermissions = Role[] | { read: Role[]; write: Role[] }

export type ShareId = string & { __shareId: false }

export type Role = string

export type IdGenerator = () => ShareId
