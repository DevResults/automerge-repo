import assert from "assert"
import {
  createDevice,
  createUser,
  redactDevice,
  redactUser,
} from "@localfirst/auth"
import { PeerId, Repo } from "automerge-repo"
import { MessageChannelNetworkAdapter } from "automerge-repo-network-messagechannel"
import { AuthProviderConfig, LocalFirstAuthProvider, ShareId } from "../src"

import { expectPromises } from "../../automerge-repo/test/helpers/expectPromises.js"
import { eventPromise } from "../../automerge-repo/src/helpers/eventPromise.js"

describe("localfirst/auth provider", () => {
  it("???", async () => {
    const alice = createUser("alice")
    const aliceDevice = createDevice(alice.userId, "ALICE-MACBOOK-2023")

    const config: AuthProviderConfig = {
      user: alice,
      device: aliceDevice,
    }

    const aliceAuthProvider = new LocalFirstAuthProvider(config)

    const aliceBobChannel = new MessageChannel()
    const { port1: aliceToBob, port2: bobToAlice } = aliceBobChannel

    const aliceRepo = new Repo({
      network: [new MessageChannelNetworkAdapter(aliceToBob)],
      peerId: "alice" as PeerId,
      authProvider: aliceAuthProvider,
    })

    const shareId = aliceAuthProvider.createShare("alice's share")

    const bob = createUser("bob")
    const bobDevice = createDevice(bob.userId, "bob-samsung-tablet")

    // Now we pretend Alice already has interacted with Bob and knows his public keys. The
    // "redacted" user object doesn't have the private keys, and that's what Alice would have
    // stored.
    aliceAuthProvider.addMember(shareId, redactUser(bob))
    aliceAuthProvider.addDevice(shareId, redactDevice(bobDevice))

    // Alice saves her state
    const savedState = aliceAuthProvider.getState()

    // Bob magically has the same state as Alice
    const bobAuthProvider = new LocalFirstAuthProvider({
      user: bob,
      device: bobDevice,
      source: savedState,
    })

    const bobRepo = new Repo({
      network: [new MessageChannelNetworkAdapter(bobToAlice)],
      peerId: "bob" as PeerId,
      authProvider: bobAuthProvider,
    })

    const aliceHandle = aliceRepo.create<TestDoc>()
    aliceHandle.change(d => {
      d.foo = "bar"
    })

    // if these resolve, we've been authenticated
    await expectPromises(
      eventPromise(aliceRepo.networkSubsystem, "peer"), // ✅
      eventPromise(bobRepo.networkSubsystem, "peer") // ✅
    )
    // bob should now receive alice's document
    const bobHandle = bobRepo.find<TestDoc>(aliceHandle.documentId)
    await eventPromise(bobHandle, "change")
    const doc = await bobHandle.value()
    assert.equal(doc.foo, "bar")

    aliceToBob.close()
    bobToAlice.close()
  })
})

export interface TestDoc {
  foo: string
}
