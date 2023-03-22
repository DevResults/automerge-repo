import assert from "assert"
import {
  createDevice,
  createTeam,
  createUser,
  InitialContext,
  redactDevice,
} from "@localfirst/auth"
import { PeerId, Repo } from "automerge-repo"
import { MessageChannelNetworkAdapter } from "automerge-repo-network-messagechannel"
import { LocalFirstAuthProvider } from "../src"

import { eventPromise } from "../../automerge-repo/src/helpers/eventPromise.js"

describe("localfirst/auth provider", () => {
  it("can authenticate invited users", async () => {
    const alice = createUser("alice")
    const aliceDevice = createDevice(alice.userId, "ALICE-MACBOOK-2023")

    const team = createTeam("a team", { user: alice, device: aliceDevice })
    const { seed: bobInvite } = team.inviteMember()

    const config: InitialContext = {
      user: alice,
      device: aliceDevice,
      team: team,
    }

    const aliceAuthProvider = new LocalFirstAuthProvider(config)

    const aliceBobChannel = new MessageChannel()
    const { port1: aliceToBob, port2: bobToAlice } = aliceBobChannel

    const aliceRepo = new Repo({
      network: [new MessageChannelNetworkAdapter(aliceToBob)],
      peerId: "alice" as PeerId,
      authProvider: aliceAuthProvider,
    })

    const bob = createUser("bob")
    const bobDevice = createDevice(bob.userId, "bob-samsung-tablet")

    // Bob has an invite from Alice (shared via side channel)
    const bobAuthProvider = new LocalFirstAuthProvider({
      user: bob,
      device: bobDevice,
      invitationSeed: bobInvite,
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
    await Promise.all([
      eventPromise(aliceRepo.networkSubsystem, "peer"), // ✅
      eventPromise(bobRepo.networkSubsystem, "peer"), // ✅
    ])

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
