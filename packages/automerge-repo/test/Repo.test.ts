import assert from "assert"
import { MessageChannelNetworkAdapter } from "automerge-repo-network-messagechannel"

import { ChannelId, DocHandle, DocumentId, PeerId } from "../src"
import {
  AuthenticateFn,
  AuthProvider,
  SharePolicy,
} from "../src/auth/AuthProvider.js"
import { DummyPasswordAuthProvider } from "./helpers/DummyPasswordAuthProvider.js"
import { eventPromise } from "../src/helpers/eventPromise.js"
import { pause } from "../src/helpers/pause.js"
import { Repo } from "../src/Repo.js"
import { DummyNetworkAdapter } from "./helpers/DummyNetworkAdapter.js"
import { DummyStorageAdapter } from "./helpers/DummyStorageAdapter.js"
import { expectPromises } from "./helpers/expectPromises"
import { getRandomItem } from "./helpers/getRandomItem.js"
import { TestDoc } from "./types.js"
import { DummyAuthProvider } from "./helpers/DummyAuthProvider.js"

describe("Repo", () => {
  describe("single repo", () => {
    const setup = () => {
      const repo = new Repo({
        storage: new DummyStorageAdapter(),
        network: [new DummyNetworkAdapter()],
      })
      return { repo }
    }

    it("can instantiate a Repo", () => {
      const { repo } = setup()
      assert.notEqual(repo, null)
      assert(repo.networkSubsystem)
      assert(repo.storageSubsystem)
    })

    it("can create a document", () => {
      const { repo } = setup()
      const handle = repo.create()
      assert.notEqual(handle.documentId, null)
    })

    it("can change a document", async () => {
      const { repo } = setup()
      const handle = repo.create<TestDoc>()
      handle.change(d => {
        d.foo = "bar"
      })
      const v = await handle.value()
      assert.equal(handle.isReady(), true)

      assert.equal(v.foo, "bar")
    })

    it("can find a created document", async () => {
      const { repo } = setup()
      const handle = repo.create<TestDoc>()
      handle.change(d => {
        d.foo = "bar"
      })
      assert.equal(handle.isReady(), true)

      const bobHandle = repo.find<TestDoc>(handle.documentId)

      assert.equal(handle, bobHandle)
      assert.equal(handle.isReady(), true)

      const v = await bobHandle.value()
      assert.equal(v.foo, "bar")
    })

    it("can use a custom id generator", () => {
      const idGenerator = () => `foo-${Math.random()}` as DocumentId
      const repo = new Repo({
        storage: new DummyStorageAdapter(),
        network: [new DummyNetworkAdapter()],
        idGenerator,
      })
      const handle = repo.create<TestDoc>()
      assert.equal(handle.documentId.slice(0, 3), "foo")
    })
  })

  describe("sync", async () => {
    const setup = async () => {
      // Set up three repos; connect Alice to Bob, and Bob to Charlie

      const aliceBobChannel = new MessageChannel()
      const bobCharlieChannel = new MessageChannel()

      const { port1: aliceToBob, port2: bobToAlice } = aliceBobChannel
      const { port1: bobToCharlie, port2: charlieToBob } = bobCharlieChannel

      const excludedDocuments: DocumentId[] = []

      const sharePolicy: SharePolicy = async (peerId, documentId) => {
        if (documentId === undefined) return false

        // make sure that charlie never gets excluded documents
        if (excludedDocuments.includes(documentId) && peerId === "charlie")
          return false

        return true
      }

      const authProvider = new DummyAuthProvider({ sharePolicy })

      const aliceRepo = new Repo({
        network: [new MessageChannelNetworkAdapter(aliceToBob)],
        peerId: "alice" as PeerId,
        authProvider,
      })

      const bobRepo = new Repo({
        network: [
          new MessageChannelNetworkAdapter(bobToAlice),
          new MessageChannelNetworkAdapter(bobToCharlie),
        ],
        peerId: "bob" as PeerId,
        authProvider,
      })

      const charlieRepo = new Repo({
        network: [new MessageChannelNetworkAdapter(charlieToBob)],
        peerId: "charlie" as PeerId,
      })

      const aliceHandle = aliceRepo.create<TestDoc>()
      aliceHandle.change(d => {
        d.foo = "bar"
      })

      const notForCharlieHandle = aliceRepo.create<TestDoc>()
      const notForCharlie = notForCharlieHandle.documentId
      excludedDocuments.push(notForCharlie)
      notForCharlieHandle.change(d => {
        d.foo = "baz"
      })

      await Promise.all([
        eventPromise(aliceRepo.networkSubsystem, "peer"),
        eventPromise(bobRepo.networkSubsystem, "peer"),
        eventPromise(charlieRepo.networkSubsystem, "peer"),
      ])

      const teardown = () => {
        aliceBobChannel.port1.close()
        bobCharlieChannel.port1.close()
      }

      return {
        aliceRepo,
        bobRepo,
        charlieRepo,
        aliceHandle,
        notForCharlie,
        teardown,
      }
    }

    it("changes are replicated from aliceRepo to bobRepo", async () => {
      const { bobRepo, aliceHandle, teardown } = await setup()

      const bobHandle = bobRepo.find<TestDoc>(aliceHandle.documentId)
      await eventPromise(bobHandle, "change")
      const bobDoc = await bobHandle.value()
      assert.deepStrictEqual(bobDoc, { foo: "bar" })
      teardown()
    })

    it("can load a document from aliceRepo on charlieRepo", async () => {
      const { charlieRepo, aliceHandle, teardown } = await setup()

      const handle3 = charlieRepo.find<TestDoc>(aliceHandle.documentId)
      await eventPromise(handle3, "change")
      const doc3 = await handle3.value()
      assert.deepStrictEqual(doc3, { foo: "bar" })
      teardown()
    })

    it("charlieRepo doesn't have a document it's not supposed to have", async () => {
      const { aliceRepo, bobRepo, charlieRepo, notForCharlie, teardown } =
        await setup()

      // HACK: we don't know how long to wait before confirming the handle would have been advertised but wasn't
      await pause(100)

      assert.notEqual(aliceRepo.handles[notForCharlie], undefined, "alice yes")
      assert.notEqual(bobRepo.handles[notForCharlie], undefined, "bob yes")
      assert.equal(charlieRepo.handles[notForCharlie], undefined, "charlie no")

      teardown()
    })

    it("can broadcast a message", async () => {
      const { aliceRepo, bobRepo, teardown } = await setup()

      const channelId = "m/broadcast" as ChannelId
      const data = { presence: "bob" }

      bobRepo.ephemeralData.broadcast(channelId, data)
      const d = await eventPromise(aliceRepo.ephemeralData, "data")

      assert.deepStrictEqual(d.data, data)
      teardown()
    })

    it("syncs a bunch of changes", async () => {
      const { aliceRepo, bobRepo, charlieRepo, teardown } = await setup()

      // HACK: yield to give repos time to get the one doc that aliceRepo created
      await pause(50)

      for (let i = 0; i < 100; i++) {
        // pick a repo
        const repo = getRandomItem([aliceRepo, bobRepo, charlieRepo])
        const docs = Object.values(repo.handles)
        const doc =
          Math.random() < 0.5
            ? // heads, create a new doc
              repo.create<TestDoc>()
            : // tails, pick a random doc
              (getRandomItem(docs) as DocHandle<TestDoc>)
        // make a random change to it
        doc.change(d => {
          d.foo = Math.random().toString()
        })
      }
      await pause(500)

      teardown()
    })
  })

  describe("authentication", () => {
    const setup = async (authProvider: AuthProvider) => {
      const aliceBobChannel = new MessageChannel()
      const { port1: aliceToBob, port2: bobToAlice } = aliceBobChannel

      const aliceRepo = new Repo({
        network: [new MessageChannelNetworkAdapter(aliceToBob)],
        peerId: "alice" as PeerId,
        authProvider,
      })

      const bobRepo = new Repo({
        network: [new MessageChannelNetworkAdapter(bobToAlice)],
        peerId: "bob" as PeerId,
        authProvider,
      })

      const aliceHandle = aliceRepo.create<TestDoc>()
      aliceHandle.change(d => {
        d.foo = "bar"
      })

      const teardown = () => {
        aliceBobChannel.port1.close()
      }

      return {
        aliceRepo,
        bobRepo,
        aliceHandle,
        teardown,
      }
    }

    it("doesn't connect when authentication fails", async () => {
      const authenticate: AuthenticateFn = async () => ({
        isValid: false,
        error: new Error("nope"),
      })
      const { aliceRepo, bobRepo, teardown } = await setup(
        new DummyAuthProvider({ authenticate })
      )

      await expectPromises(
        eventPromise(aliceRepo.networkSubsystem, "error"),
        eventPromise(bobRepo.networkSubsystem, "error")
      )

      teardown()
    })

    it("error message is emitted on the peer that denied connection", async () => {
      const authenticate: AuthenticateFn = async (peerId: PeerId) => {
        if (peerId == "alice") {
          return { isValid: true }
        } else {
          return {
            isValid: false,
            error: new Error("you are not Alice"),
          }
        }
      }
      const { aliceRepo, bobRepo, teardown } = await setup(
        new DummyAuthProvider({ authenticate })
      )

      await expectPromises(
        eventPromise(aliceRepo.networkSubsystem, "error"), // I am bob's failed attempt to connect
        eventPromise(bobRepo.networkSubsystem, "peer")
      )

      teardown()
    })

    it("can communicate over the network to authenticate", async () => {
      const { aliceRepo, bobRepo, teardown } = await setup(
        new DummyPasswordAuthProvider("password")
      )

      await expectPromises(
        eventPromise(aliceRepo.networkSubsystem, "peer"),
        eventPromise(bobRepo.networkSubsystem, "peer")
      )

      teardown()
    })
  })
})
