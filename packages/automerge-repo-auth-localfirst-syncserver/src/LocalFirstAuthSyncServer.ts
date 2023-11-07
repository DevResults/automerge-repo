import fs from "fs"
import express from "express"
import bodyParser from "body-parser"
import { Server as HttpServer } from "http"
import { WebSocketServer } from "ws"
import { PeerId, Repo, RepoConfig } from "@automerge/automerge-repo"
import { NodeWSServerAdapter } from "@automerge/automerge-repo-network-websocket"
import { NodeFSStorageAdapter } from "@automerge/automerge-repo-storage-nodefs"
import { LocalFirstAuthProvider } from "@automerge/automerge-repo-auth-localfirst"
import path from "path"
import {
  Keyset,
  KeysetWithSecrets,
  Team,
  createKeyset,
  redactKeys,
} from "@localfirst/auth"

/**
 * This is a sync server for use with automerge-repo and the LocalFirstAuthProvider.
 */
export class LocalFirstAuthSyncServer {
  socket: WebSocketServer
  server: HttpServer
  host: string
  storageDir: string
  publicKeys: Keyset

  constructor(
    /** The domain name or IP address of this server. This should match the name added to the
     * localfirst/auth team. */
    host: string
  ) {
    this.host = host
  }

  async listen(
    options: {
      port?: number
      storageDir?: string
      silent?: boolean
    } = {}
  ) {
    return new Promise<void>((resolve, reject) => {
      const {
        port = 3000,
        storageDir = "automerge-repo-data",
        silent = false,
      } = options
      this.storageDir = storageDir

      if (!fs.existsSync(storageDir)) fs.mkdirSync(storageDir)

      // Get keys from storage or create new ones
      const keys = this.#getKeys()
      this.publicKeys = redactKeys(keys)

      // Create the socket we will use. localfirst/auth will use this to send and receive
      // authentication messages, and Automerge Repo will use it to send and receive sync messages
      this.socket = new WebSocketServer({ noServer: true })

      // Set up the auth provider
      // TODO: localfirst/auth could shield us from this nonsense of casting a server as a fake user
      // and a fake device. Ideally we would just pass our server name and keys as context instead of
      // having to pretend:
      // ```ts
      //  const authContext = { server: { host, keys } }
      // ```
      const userId = this.host
      const userName = this.host
      const deviceName = this.host
      const authContext = {
        user: { userId, userName, keys },
        device: { userId, deviceName, keys },
      }

      const auth = new LocalFirstAuthProvider(authContext)
      const network = [new NodeWSServerAdapter(this.socket)]
      const storage = new NodeFSStorageAdapter(storageDir)

      const peerId = this.host as PeerId
      const _repo = new Repo({ peerId, network, storage, auth })

      const app = express()

      // parse application/json
      app.use(bodyParser.json())

      const confirmation = `👍 Sync server for Automerge Repo + localfirst/auth running`
      app.get("/", (req, res) => {
        res.send(confirmation)
      })

      /**
       * Endpoint to register a team.
       *
       * The intended workflow is:
       * - The application creates a team
       * - The application uses this endpoint to send the team graph and keys to the server
       * - The server adds the team to its auth provider
       * - The server responds with its public keys
       * - The application adds the server to the team
       * - The application can now use localfirst/auth to authenticate with the server
       *
       * No invitation or authentication is necessary when calling this endpoint, as a TLS connection
       * to a trusted address is sufficient to ensure that the application is talking to the right
       * server.
       */
      app.post("/teams", (req, res) => {
        // rehydrate the team using the serialized graph and the keys passed in the request
        const { serializedGraph, teamKeyring } = req.body

        const team = new Team({
          source: serializedGraph,
          context: authContext,
          teamKeyring,
        })

        // add the team to our auth provider
        auth.addTeam(team)
      })

      app.get("/keys", (req, res) => {
        res.send(this.publicKeys)
      })

      this.server = app.listen(port, () => {
        if (!silent) {
          console.log(confirmation)
          console.log(`listening on port ${port}`)
        }
        resolve()
      })

      /**
       * When we successfully upgrade the client to a WebSocket connection, we emit a "connection"
       * event, which is handled by the NodeWSServerAdapter.
       */
      this.server.on("upgrade", (request, socket, head) => {
        this.socket.handleUpgrade(request, socket, head, socket => {
          this.socket.emit("connection", socket, request)
        })
      })
    })
  }

  close() {
    this.socket.close()
    this.server.close()
  }

  #getKeys = () => {
    const keysPath = path.join(this.storageDir, "__SERVER_KEYS.json")
    if (fs.existsSync(keysPath)) {
      // retrieve from storage
      const serializedKeys = fs.readFileSync(keysPath, "utf8")
      const keys = JSON.parse(serializedKeys) as KeysetWithSecrets
      return keys
    } else {
      // create & store new keys
      const keys = createKeyset({ type: "SERVER", name: this.host })
      fs.writeFileSync(keysPath, JSON.stringify(keys, null, 2))
      return keys
    }
  }
}
