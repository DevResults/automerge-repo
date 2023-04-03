import assert from "assert"
import {
  createDevice,
  createTeam,
  createUser,
  InitialContext,
  loadTeam,
  redactDevice,
} from "@localfirst/auth"
import { PeerId, Repo } from "automerge-repo"
import { MessageChannelNetworkAdapter } from "automerge-repo-network-messagechannel"
import { LocalFirstAuthProvider } from "../src"

import { eventPromise } from "../../automerge-repo/src/helpers/eventPromise.js"

describe("localfirst/auth provider", () => {
  it.only("can authenticate users that are already on the same team", async () => {
    const alice = createUser("alice")
    const aliceDevice = createDevice(alice.userId, "ALICE-MACBOOK-2023")

    const aliceBobChannel = new MessageChannel()
    const { port1: aliceToBob, port2: bobToAlice } = aliceBobChannel

    const aliceTeam = createTeam("a team", { user: alice, device: aliceDevice })

    const aliceAuthProvider = new LocalFirstAuthProvider({
      device: aliceDevice,
      user: alice,
    })
    aliceAuthProvider.
    const aliceRepo = new Repo({
      network: [new MessageChannelNetworkAdapter(aliceToBob)],
      peerId: "alice" as PeerId,
      authProvider: aliceAuthProvider,
    })

    // Let's pretend Bob is already on Alice's team and has synced up in the past
    const bob = createUser("bob")
    const bobDevice = createDevice(bob.userId, "bob-samsung-tablet")
    aliceTeam.addForTesting(bob, [], redactDevice(bobDevice))
    const bobTeam = loadTeam(
      aliceTeam.save(),
      {
        device: bobDevice,
        user: bob,
      },
      aliceTeam.teamKeys()
    )

    const bobAuthProvider = new LocalFirstAuthProvider({
      user: bob,
      device: bobDevice,
      team: bobTeam,
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

    console.log
    // if these resolve, we've been authenticated
    await Promise.all([
      eventPromise(aliceRepo.networkSubsystem, "peer"),
      eventPromise(bobRepo.networkSubsystem, "peer"),
    ])

    // bob should now receive alice's document
    const bobHandle = bobRepo.find<TestDoc>(aliceHandle.documentId)
    await eventPromise(bobHandle, "change")
    const doc = await bobHandle.value()
    assert.equal(doc.foo, "bar")

    aliceToBob.close()
    bobToAlice.close()
  })

  it("can authenticate an invited user", async () => {
    const alice = createUser("alice")
    const aliceDevice = createDevice(alice.userId, "ALICE-MACBOOK-2023")

    const aliceBobChannel = new MessageChannel()
    const { port1: aliceToBob, port2: bobToAlice } = aliceBobChannel

    const team = createTeam("a team", { device: aliceDevice, user: alice })
    const { seed: bobInvite } = team.inviteMember()

    const config: InitialContext = {
      user: alice,
      device: aliceDevice,
      team: team,
    }

    const aliceAuthProvider = new LocalFirstAuthProvider(config)

    const aliceRepo = new Repo({
      network: [new MessageChannelNetworkAdapter(aliceToBob)],
      peerId: "alice" as PeerId,
      authProvider: aliceAuthProvider,
    })

    const bob = createUser("bob")
    const bobDevice = createDevice(bob.userId, "bob-samsung-tablet")

    // Bob has an invite from Alice (shared via side channel)
    const bobAuthProvider = new LocalFirstAuthProvider({
      device: bobDevice,
      memberInvitation: {
        user: bob,
        teamId: team.id,
        invitationSeed: bobInvite,
      },
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
      eventPromise(aliceRepo.networkSubsystem, "peer"),
      eventPromise(bobRepo.networkSubsystem, "peer"),
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
