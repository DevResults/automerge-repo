import {
  WrappedAdapter,
  AuthProvider,
  ChannelId,
  NetworkAdapter,
  PeerId,
} from "automerge-repo"
import {
  Connection,
  DeviceWithSecrets,
  Team,
  UserWithSecrets,
  symmetric,
  InviteeDeviceInitialContext,
  InitialContext,
  InviteeMemberInitialContext,
  MemberInitialContext,
} from "@localfirst/auth"

const { encrypt, decrypt } = symmetric

const authChannelName = (teamId: string) => `a/${teamId}` as ChannelId

export class LocalFirstAuthProvider extends AuthProvider {
  device: DeviceWithSecrets
  user?: UserWithSecrets

  // TODO: support multiple invitations?
  deviceInvitation?: DeviceInvitation
  memberInvitation?: MemberInvitation

  teams: Record<string, Team> = {}
  connections: Record<string, Record<PeerId, Connection>> = {} // one per team per peer

  constructor(config: AuthProviderConfig) {
    super()
    // we always are given the local device's info & keys
    this.device = config.device

    // we might already have our user info, unless we're a first-time device being invited
    if ("user" in config) this.user = config.user

    // we might already belong to one or more teams
    if ("team" in config) {
      const teams = !Array.isArray(config.team) ? [config.team] : config.team
      teams.forEach(team => {
        this.teams[team.id] = team
      })
    }

    // we might have been invited to join a team as an existing user's device
    if ("deviceInvitation" in config) {
      this.deviceInvitation = config.deviceInvitation
    }

    // we might have been invited to join a team as a new member
    if ("memberInvitation" in config) {
      this.memberInvitation = config.memberInvitation
    }
  }

  public joinAsInvitedDevice({
    userName,
    userId,
    teamId,
    invitationSeed,
  }: DeviceInvitation) {}

  // override
  wrapNetworkAdapter = (baseAdapter: NetworkAdapter) => {
    const wrappedAdapter = new WrappedAdapter(baseAdapter, this.transform)

    // try to authenticate new peers; if we succeed, we forward the peer-candidate event
    baseAdapter.on("peer-candidate", async ({ peerId, channelId }) => {
      const teamId = channelId.slice(2) // everything after 'a/' 🥴

      if (this.connections[teamId][peerId]) return // TODO: if a connection already exists, should we close it and create a new one?

      const getContext = () => {
        if (this.user && this.teams[teamId]) {
          return {
            device: this.device,
            team: this.teams[teamId],
            user: this.user,
          } as MemberInitialContext
        } else if (this.deviceInvitation) {
          return {
            device: this.device,
            ...this.deviceInvitation,
          } as InviteeDeviceInitialContext
        } else if (this.memberInvitation) {
          return {
            device: this.device,
            ...this.memberInvitation,
          } as InviteeMemberInitialContext
        }
        throw new Error()
      }

      const connection = new Connection({
        context: getContext(),
        sendMessage: message => {
          const messageBytes = new TextEncoder().encode(message)
          baseAdapter.sendMessage(
            peerId,
            authChannelName(teamId),
            messageBytes,
            false
          )
        },
        peerUserId: peerId,
      })
      this.connections[teamId][peerId] = connection

      connection
        .on("joined", ({ team, user }) => {
          this.user = user
          this.teams[team.id] = team
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
          this.connections[teamId][peerId].removeAllListeners()
          delete this.connections[teamId][peerId]
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
          this.connections[teamId][peerId].deliver(
            new TextDecoder().decode(message)
          )
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

/** I know my device keys regardless of my membership status */
type ConfigBase = {
  device: DeviceWithSecrets
}

/** I'm a first-time user, going to create a team */
type ConfigWithUser = ConfigBase & {
  user: UserWithSecrets
}

/** I'm already on one or more teams */
type ConfigWithExistingTeam = ConfigBase & {
  user: UserWithSecrets
  team: Team | Team[]
}

/** I'm a first-time device, joining with a device invitation  */
type ConfigWithDeviceInvitation = ConfigBase & {
  deviceInvitation: DeviceInvitation
}

/** I'm a first-time user, joining with a member invitation */
type ConfigWithMemberInvitation = ConfigBase & {
  memberInvitation: MemberInvitation
}

export type AuthProviderConfig =
  | ConfigWithUser
  | ConfigWithDeviceInvitation
  | ConfigWithMemberInvitation
  | ConfigWithExistingTeam

export type Optional<T, K extends keyof T> = Omit<T, K> & Partial<T>

type DeviceInvitation = {
  userName: string
  userId: string
  teamId: string
  invitationSeed: string
}

type MemberInvitation = {
  user: UserWithSecrets
  teamId: string
  invitationSeed: string
}
