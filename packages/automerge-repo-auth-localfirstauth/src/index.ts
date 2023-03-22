import { AuthProvider, ChannelId, NetworkAdapter, PeerId } from "automerge-repo"

import {
  Connection,
  DeviceWithSecrets,
  InitialContext,
  Team,
  UserWithSecrets,
} from "@localfirst/auth"
import { WrappedAdapter } from "automerge-repo/dist/auth/AuthProvider"

const AUTH_CHANNEL = "auth_channel" as ChannelId

export class LocalFirstAuthProvider extends AuthProvider {
  team: Team
  connections: Record<PeerId, Connection> = {}

  constructor(private context: InitialContext) {
    super()
    if ("team" in context) this.team = context.team
  }

  // override
  wrapNetworkAdapter = (baseAdapter: NetworkAdapter) => {
    const wrappedAdapter = new WrappedAdapter(baseAdapter, this.transform)

    // try to authenticate new peers; if we succeed, we forward the peer-candidate event
    baseAdapter.on("peer-candidate", async ({ peerId, channelId }) => {
      if (this.connections[peerId] != null) return // maybe try reconnecting or something?
      const connection = new Connection({
        context: this.context,
        sendMessage: message => {
          const messageBytes = new TextEncoder().encode(message)
          baseAdapter.sendMessage(peerId, AUTH_CHANNEL, messageBytes, false)
        },
        peerUserId: peerId,
      })
      this.connections[peerId] = connection

      connection
        .on("joined", ({ team }) => {
          this.team = team // TODO: sync server needs to have more than one team, right?
        })
        .on("connected", () => {
          // const seed = connection.seed
          // TODO encrypt with this seed
          this.transform.inbound = payload => {
            // const decrypted = decrypt(payload.message, secretKey)
            // return { ...payload, message: decrypted }
            return payload
          }
          this.transform.outbound = payload => {
            // const encrypted = encrypt(payload.message, secretKey)
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
          this.connections[peerId].removeAllListeners()
          delete this.connections[peerId]
          wrappedAdapter.emit("peer-disconnected", { peerId })
        })

      connection.start()
    })

    // transform incoming messages
    baseAdapter.on("message", payload => {
      try {
        if (payload.channelId === AUTH_CHANNEL) {
          const { senderId: peerId, message } = payload
          this.connections[peerId].deliver(new TextDecoder().decode(message))
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
  user: UserWithSecrets
  device: DeviceWithSecrets
  team: Team
}
