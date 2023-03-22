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
  team: Team
  connection: Connection

  constructor(private context: InitialContext) {
    super()
    if ("team" in context) this.team = context.team
  }

  // NEXT:
  // instead of this, override the whole wrapNetworkAdapter method

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

    this.connection = connection

    channel.on("message", messageBytes => {
      const message = new TextDecoder().decode(messageBytes)
      connection.deliver(message)
    })
    try {
      await new Promise<void>((resolve, reject) => {
        connection
          .on("joined", ({ team }) => {
            this.team = team
            // resolve()
          })
          .on("connected", () => {
            // const seed = connection.seed
            // TODO encrypt with this seed
            this.transform = {
              inbound: payload => {
                // const decrypted = decrypt(payload.message, secretKey)
                // return { ...payload, message: decrypted }
                return payload
              },
              outbound: payload => {
                // const encrypted = encrypt(payload.message, secretKey)
                // return { ...payload, message: encrypted }
                return payload
              },
            }
            resolve()
          })
          .on("change", state => {
            // TODO: I don't think we need to do anything here?
          })
          .on("localError", type => {
            reject(type)
          })
          .on("remoteError", type => {
            reject(type)
          })
          .on("disconnected", event => {
            reject("disconnected")
          })

        connection.start()
      })
      return AUTHENTICATION_VALID
    } catch (error) {
      return authenticationError(error.message)
    }
  }
}

export type AuthProviderConfig = {
  user: UserWithSecrets
  device: DeviceWithSecrets
  team: Team
}
