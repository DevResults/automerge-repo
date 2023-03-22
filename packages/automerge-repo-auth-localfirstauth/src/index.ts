import {
  AuthenticateFn,
  authenticationError,
  AUTHENTICATION_VALID,
  AuthProvider,
} from "automerge-repo"

import {
  Connection,
  DeviceWithSecrets,
  InitialContext,
  Member,
  Team,
  UserWithSecrets,
} from "@localfirst/auth"

export class LocalFirstAuthProvider extends AuthProvider {
  constructor(private context: InitialContext) {
    super()
  }

  // override

  authenticate: AuthenticateFn = async (peerId, channel) => {
    const connection = new Connection({
      context: this.context,
      sendMessage: message => {
        const messageBytes = new TextEncoder().encode(message)
        channel.send(messageBytes)
      },
      peerUserId: peerId,
    })
    channel.on("message", messageBytes => {
      const message = new TextDecoder().decode(messageBytes)
      connection.deliver(message)
    })
    try {
      await new Promise<void>((resolve, reject) => {
        connection
          .on("joined", ({ team, user }) => {
            // no longer an invitee - update our context for future connections
            // const { device } = this.context as InviteeMemberInitialContext
            // this.context = { device, user, team } as MemberInitialContext
            // this.emit("joined", { team, user })
            resolve()
          })
          .on("connected", () => {
            // this.emit("connected", connection)
            resolve()
          })
          .on("change", state => {
            // this.updateStatus(peerUserName, state)
            // this.emit("change", { userName: peerUserName, state })
          })
          .on("localError", type => {
            // this.emit("localError", type)
            reject(type)
          })
          .on("remoteError", type => {
            // this.emit("remoteError", type)
            reject(type)
          })
          .on("disconnected", event => {
            // this.disconnectPeer(peerUserName, event)
            // resolve()
          })

        connection.start()
      })
      return AUTHENTICATION_VALID
    } catch (error) {
      return authenticationError(error.message)
    }
  }

  // custom methods

  members(): Member[]
  members(userId: string): Member

  members(userId?: string): Member | Member[] {
    // return this.context.team.members(userId)
    throw "not implemented"
  }

  inviteMember = (): { id: string; seed: string } => {
    // const { id, seed } = this.team.inviteMember()
    // return { id, seed }
    throw "not implemented"
  }

  inviteDevice = (): { id: string; seed: string } => {
    throw "not implemented"
  }
}

export type AuthProviderConfig = {
  user: UserWithSecrets
  device: DeviceWithSecrets
  team: Team
}
