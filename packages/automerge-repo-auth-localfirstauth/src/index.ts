import {
  Base58,
  Connection,
  createTeam,
  DeviceWithSecrets,
  Hash,
  Keyset,
  KeysetWithSecrets,
  loadTeam,
  MemberInitialContext,
  symmetric,
  Team,
  UserWithSecrets,
} from "@localfirst/auth"
import assert from "assert"
import {
  AuthProvider,
  ChannelId,
  DocumentId,
  NetworkAdapter,
  PeerId,
  WrappedAdapter,
} from "automerge-repo"
const { encrypt, decrypt } = symmetric

export class LocalFirstAuthProvider extends AuthProvider {
  private device: DeviceWithSecrets
  private user?: UserWithSecrets
  private shares: Record<ShareId, Share> = {} as Record<ShareId, Share>

  constructor(config: AuthProviderConfig) {
    super()
    // we always are given the local device's info & keys
    this.device = config.device

    // we might already have our user info, unless we're a first-time device being invited
    if ("user" in config) this.user = config.user
  }

  public save() {
    const shares = {} as PartiallySerializedState
    for (const shareId in this.shares) {
      const share = this.shares[shareId]
      shares[shareId] = {
        encryptedTeam: share.team.save(),
        encryptedTeamKeys: symmetric.encrypt(
          share.team.teamKeys,
          this.device.keys.secretKey
        ),
        documentIds: [...share.documentIds],
      } as PartiallySerializedShare
    }
    return JSON.stringify(shares)
  }

  public load(savedState: string) {
    const savedShares = JSON.parse(savedState) as PartiallySerializedState
    for (const shareId in savedShares) {
      const share = savedShares[shareId] as PartiallySerializedShare
      const { encryptedTeam, encryptedTeamKeys, documentIds } = share
      const teamKeys = symmetric.decrypt(
        encryptedTeamKeys,
        this.device.keys.secretKey
      ) as KeysetWithSecrets

      const context = { device: this.device, user: this.user }
      this.shares[shareId] = {
        team: loadTeam(encryptedTeam, context, teamKeys),
        teamKeys: teamKeys,
        documentIds: new Set(documentIds),
        connections: {},
      }
    }
  }

  public addShare(team: Team, documentIds: DocumentId[] = []) {
    this.shares[team.id] = {
      team,
      documentIds: new Set(documentIds),
      connections: {},
    }
    // TODO: make connections
  }

  public createShare(documentIds: DocumentId[] = []): ShareId {
    assert(this.user, "must have a user to create a share")
    const team = createTeam("", { device: this.device, user: this.user }) // TODO: Team.name isn't used for anything, should probably get rid of it
    this.shares[team.id] = {
      team,
      documentIds: new Set(documentIds),
      teamKeys: team.teamKeys(),
      connections: {},
    }
    // TODO: make connections
    return team.id as TeamId
  }

  public joinAsMember({ shareId, user, invitationSeed }: MemberInvitation) {
    this.user = user // just in case (we could have been instantiated without a user)
    // TODO: make connections
  }

  public joinAsDevice({
    shareId,
    userName,
    userId,
    invitationSeed,
  }: DeviceInvitation) {
    // TODO: make connections
  }

  public inviteMember({
    shareId,
    seed,
    expiration,
    maxUses,
  }: InviteMemberParams) {
    const share = this.shares[shareId]
    assert(share, `share not found: ${shareId}`)
    return share.team.inviteMember({ seed, expiration, maxUses })
  }

  public inviteDevice({ shareId, seed, expiration }: InviteDeviceParams) {
    const share = this.shares[shareId]
    assert(share, `share not found: ${shareId}`)
    return share.team.inviteDevice({ seed, expiration })
  }

  public addDocuments(shareId: ShareId, documentIds: DocumentId[]) {
    const share = this.shares[shareId]
    assert(share, `share not found: ${shareId}`)
    documentIds.forEach(id => share.documentIds.add(id))
  }

  // override
  wrapNetworkAdapter = (baseAdapter: NetworkAdapter) => {
    const wrappedAdapter = new WrappedAdapter(baseAdapter, this.transform)

    // try to authenticate new peers; if we succeed, we forward the peer-candidate event
    baseAdapter.on("peer-candidate", async ({ peerId, channelId }) => {
      console.log({ peerId, channelId })

      const shareId = channelId.slice(2) as ShareId // everything after 'a/'

      const getContext = () => {
        if (this.user && this.shares[shareId]) {
          return {
            device: this.device,
            team: this.shares[shareId].team,
            user: this.user,
          } as MemberInitialContext
        }
        // else if (this.deviceInvitation) {
        //   return {
        //     device: this.device,
        //     ...this.deviceInvitation,
        //   } as InviteeDeviceInitialContext
        // } else if (this.memberInvitation) {
        //   return {
        //     device: this.device,
        //     ...this.memberInvitation,
        //   } as InviteeMemberInitialContext
        throw new Error()
      }

      const connection = new Connection({
        context: getContext(),
        sendMessage: message => {
          const messageBytes = new TextEncoder().encode(message)
          baseAdapter.sendMessage(
            peerId,
            authChannelName(shareId),
            messageBytes,
            false
          )
        },
        peerUserId: peerId,
      })
      this.shares[shareId][peerId] = connection

      connection
        .on("joined", ({ team, user }) => {
          this.user = user
          this.shares[team.id].team = team
        })
        .on("connected", () => {
          const { seed } = connection.context
          this.transform.inbound = payload => {
            // const message = payload.message
            // const decrypted = new TextEncoder().encode(
            //   decrypt(message, connection.seed)
            // )
            // return { ...payload, message: decrypted }
            return payload
          }
          this.transform.outbound = payload => {
            // const encrypted = new TextEncoder().encode(
            //   encrypt(payload.message, connection.seed)
            // )
            // return { ...payload, message: encrypted }
            return payload
          }
          wrappedAdapter.emit("peer-candidate", { peerId, channelId })
        })
        .on("change", state => {
          // TODO: I don't think we need to do anything here?
        })
        .on("localError", type => {
          // disconnect?
        })
        .on("remoteError", type => {
          // disconnect?
        })
        .on("disconnected", event => {
          // this.connections[teamId][peerId].removeAllListeners()
          // delete this.connections[teamId][peerId]
          wrappedAdapter.emit("peer-disconnected", { peerId })
        })

      connection.start()
    })

    // transform incoming messages
    baseAdapter.on("message", payload => {
      try {
        if (payload.channelId.startsWith("a/")) {
          const teamId = payload.channelId.slice(2)
          const { senderId: peerId, message } = payload
          // this.connections[teamId][peerId].deliver(
          //   new TextDecoder().decode(message)
          // )
        } else {
          const transformedPayload = this.transform.inbound(payload)
          wrappedAdapter.emit("message", transformedPayload)
        }
      } catch (e) {
        wrappedAdapter.emit("error", {
          peerId: payload.senderId,
          channelId: payload.channelId,
          error: e as Error,
        })
      }
    })

    // forward all other events
    baseAdapter.on("open", payload => wrappedAdapter.emit("open", payload))
    baseAdapter.on("close", () => wrappedAdapter.emit("close"))
    baseAdapter.on("peer-disconnected", payload =>
      wrappedAdapter.emit("peer-disconnected", payload)
    )
    baseAdapter.on("error", payload => wrappedAdapter.emit("error", payload))

    return wrappedAdapter
  }
}

export type AuthProviderConfig = {
  device: DeviceWithSecrets
  user?: UserWithSecrets
  source?: string // persisted state
}

type DeviceInvitation = {
  shareId: ShareId
  userName: string
  userId: string
  invitationSeed: string
}

type MemberInvitation = {
  shareId: ShareId
  user: UserWithSecrets
  invitationSeed: string
}

type ShareId = Hash & { __shareId: true }
type TeamId = ShareId

const authChannelName = (shareId: ShareId) => `a/${shareId}` as ChannelId

type Share = {
  team: Team
  teamKeys: KeysetWithSecrets
  documentIds: Set<DocumentId>
  connections: Record<PeerId, Connection>
}

type InviteMemberOptions = Parameters<typeof Team.prototype.inviteMember>[0]
type InviteDeviceOptions = Parameters<typeof Team.prototype.inviteDevice>[0]

type InviteMemberParams = {
  shareId: ShareId
} & Partial<InviteMemberOptions>

type InviteDeviceParams = {
  shareId: ShareId
} & Partial<InviteDeviceOptions>

type PartiallySerializedShare = {
  encryptedTeam: Base58
  encryptedTeamKeys: Base58
  documentIds: DocumentId[]
}

type PartiallySerializedState = Record<ShareId, PartiallySerializedShare>
