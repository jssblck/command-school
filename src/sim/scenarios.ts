import { makeCommander, type Commander, type CommanderConfig } from './ai'
import type { Objective, World } from './types'
import { v3 } from './vec3'
import { addBody, addSquadron, createWorld, fleetStrength } from './world'

export interface Scenario {
  id: string
  name: string
  /** The line Mazer would open with. */
  epigraph: string
  brief: string[]
  /** The one new idea this battle exists to teach, shown as a hint card. */
  teaches?: string
  build(seed: number): { world: World; enemy: Commander }
}

/**
 * Blue squadrons carry call signs drawn from the women who built computing.
 * Red is a hive: its formations get shapes, not names.
 */
const BLUE = ['HOPPER', 'LOVELACE', 'WINLOCK', 'JOHNSON', 'HAMILTON', 'BARTIK', 'HOLBERTON', 'EASLEY']

const forward = v3(0, 0, 1)
const back = v3(0, 0, -1)

function shell(objective: Objective, seed: number, commLag: number, bounds = 900) {
  const w = createWorld(seed, objective, bounds)
  w.commLag = commLag
  return w
}

/**
 * `garrison` names squadrons the commander leaves alone, so they keep their
 * deployment order for the whole battle instead of being swept into the main
 * effort. That is what makes a guard a guard: without it the aegis screen and
 * the watchtowers fly off to join the shooting and the objective ends up naked.
 */
function enemyOf(
  w: World,
  cfg: Partial<CommanderConfig>,
  garrison: string[] = [],
): { world: World; enemy: Commander } {
  const enemy = makeCommander('red', cfg)
  for (const sq of w.squadrons) if (garrison.includes(sq.name)) enemy.reserved.add(sq.id)
  return { world: w, enemy }
}

export const SCENARIOS: Scenario[] = [
  {
    id: 'first-contact',
    name: 'First Contact',
    epigraph: 'You will not be told what your fleet can do. You will find out.',
    brief: [
      'Two flights of needles, nothing else in the volume. Their commander is slow and it will come straight at you.',
      'Give an order and watch how long it takes to land. That delay never goes away.',
    ],
    teaches: 'Click a squadron, then right click empty space to move it or an enemy to attack. Orders take time to reach your leaders.',
    build(seed) {
      const w = shell({ kind: 'annihilate', text: 'Destroy the enemy flight' }, seed, 0.4, 700)
      addBody(w, { kind: 'moon', name: 'Ferrous', pos: v3(-330, -90, 60), radius: 42 })
      addSquadron(w, { side: 'blue', cls: 'needle', name: BLUE[0], count: 10, at: v3(0, 0, -260), facing: forward })
      addSquadron(w, { side: 'red', cls: 'needle', name: 'DRIFT', count: 7, at: v3(30, 20, 300), facing: back })
      return enemyOf(w, { aggression: 0.5, skill: 0.15, period: 2.2 })
    },
  },

  {
    id: 'gate-is-down',
    name: 'The Enemy Gate Is Down',
    epigraph: 'There is no up. Pick a down and make the enemy live in it.',
    brief: [
      'A dead moon sits between you. Nothing shoots through rock, though sensors read straight through it, so the moon buys you a lane out of their lances rather than a way to arrive unseen.',
      'Lances reach more than twice as far as a needle but only fire through a narrow cone, so the shape you hold decides how many of them can speak at once.',
    ],
    teaches: 'Press Z X C to set a stance. Tight packs the wing under one screen and into one bracket, wide clears every barrel and spreads a wall, open splits the difference. Press G to line the reference grid up on the enemy.',
    build(seed) {
      const w = shell({ kind: 'annihilate', text: 'Destroy the enemy flight' }, seed, 0.45, 780)
      addBody(w, { kind: 'moon', name: 'Cusp', pos: v3(0, -20, 40), radius: 92 })
      addSquadron(w, { side: 'blue', cls: 'needle', name: BLUE[0], count: 12, at: v3(-120, 40, -330), facing: forward })
      addSquadron(w, { side: 'blue', cls: 'lance', name: BLUE[1], count: 4, at: v3(120, -30, -390), facing: forward })
      addSquadron(w, { side: 'red', cls: 'needle', name: 'DRIFT', count: 8, at: v3(90, 60, 340), facing: back })
      addSquadron(w, { side: 'red', cls: 'lance', name: 'THORN', count: 2, at: v3(-60, -40, 420), facing: back })
      // The lances hold their ground. Under ballistic gunnery the side that
      // crosses open volume is the side that pays, so a red that attacks with
      // everything hands the mission to a blue that never gives an order; a
      // battery that waits behind the moon is the thing the mission is about.
      return enemyOf(w, { aggression: 0.55, skill: 0.3, period: 2 }, ['THORN'])
    },
  },

  {
    id: 'deep-well',
    name: 'Deep Well',
    epigraph: 'A world is a wall you cannot shoot through.',
    brief: [
      'A live planet holds the middle of the volume. It stops bolts and it hides whatever is behind it.',
      'The straight line between your fleet and theirs runs through the rock. Your leaders will not fly into it. They will go around, and arrive late, off to one side, and strung out in front of five lances that outrange you two to one.',
      'Their swarm will cross to you first, and the side crossing open volume is the side that pays. Meet it standing. Then pick your way around.',
    ],
    teaches:
      'Hold Shift while placing a move order to set its height. A second line under the order is the run your squadrons will actually fly, and where it bows off the line you drew, the rock is charging you seconds in the open. Pick the way around yourself.',
    build(seed) {
      const w = shell({ kind: 'annihilate', text: 'Destroy the enemy fleet' }, seed, 0.5, 860)
      addBody(w, { kind: 'planet', name: 'Sorrow', pos: v3(0, 0, 30), radius: 130, mu: 130 * 130 * 6.4 })
      addBody(w, { kind: 'moon', name: 'Tack', pos: v3(280, 120, -140), radius: 34 })
      addSquadron(w, { side: 'blue', cls: 'needle', name: BLUE[0], count: 12, at: v3(-260, 80, -400), facing: forward })
      addSquadron(w, { side: 'blue', cls: 'lance', name: BLUE[1], count: 4, at: v3(-320, -60, -470), facing: forward })
      addSquadron(w, { side: 'red', cls: 'needle', name: 'DRIFT', count: 10, at: v3(240, -70, 420), facing: back })
      addSquadron(w, { side: 'red', cls: 'lance', name: 'THORN', count: 5, at: v3(310, 90, 480), facing: back })
      // Five lances that stay on their side of the rock, which is what makes the
      // route the mission: blue has to cross and they do not.
      return enemyOf(w, { aggression: 0.6, skill: 0.4, period: 1.9 }, ['THORN'])
    },
  },

  {
    id: 'shoal',
    name: 'Shoal',
    epigraph: 'A fleet you cannot see is a fleet that is already behind you.',
    brief: [
      'A debris belt cuts the volume in half. Sensors die inside it, and so do hulls, slowly.',
      'You have eyes: unarmed, fast, and able to see nearly twice as far as anything else you own. Lose them and you are commanding blind.',
    ],
    teaches:
      'A grey tick with a drop line is a memory, not a contact: it marks where a wing was when you last had it, and the ring around it how wide it was spread. Their guns can cross the belt unseen, so keep an eye alive and out of the dust.',
    build(seed) {
      const w = shell({ kind: 'annihilate', text: 'Destroy the enemy fleet' }, seed, 0.55, 900)
      addBody(w, {
        kind: 'field',
        name: 'The Shoal',
        pos: v3(0, 10, 40),
        radius: 420,
        normal: v3(0.12, 1, 0.05),
        thickness: 92,
      })
      addBody(w, { kind: 'moon', name: 'Grain', pos: v3(-200, 60, 120), radius: 46 })
      addSquadron(w, { side: 'blue', cls: 'needle', name: BLUE[0], count: 12, at: v3(-150, 150, -420), facing: forward })
      addSquadron(w, { side: 'blue', cls: 'lance', name: BLUE[1], count: 3, at: v3(60, 170, -470), facing: forward })
      addSquadron(w, { side: 'blue', cls: 'eye', name: BLUE[2], count: 2, at: v3(-260, 190, -380), facing: forward })
      /*
       * Fourteen needles and three lances against twelve and three, so their swarm is two hulls
       * up and their artillery is even.
       *
       * Their fourth lance is what came off. It was fourteen and four for most of the build, and
       * that read as a fair fight only because the belt was doing the balancing: at the old
       * debris rate red's advance paid 271 hull to the rock against blue's 139, which is a
       * third of red's fleet gone before contact
       * and never once visible as a decision either commander made. Charging what a hull can
       * actually survive in there put the fight back on the fleets, and the fleets were 21
       * points of guns against 26. Both swarms trade off almost exactly, so what the mission
       * came down to was three lances against four, which is not a fight: blue won one hand run
       * in nine and lost the other eight with their artillery two or three hulls up. Even
       * artillery is what makes the swarm trade matter, and the second eye is what blue has
       * instead of the extra needle.
       */
      addSquadron(w, { side: 'red', cls: 'needle', name: 'SHOAL', count: 14, at: v3(120, -10, 300), facing: back, scatter: 40 })
      addSquadron(w, { side: 'red', cls: 'lance', name: 'THORN', count: 3, at: v3(-180, -30, 430), facing: back })
      addSquadron(w, { side: 'red', cls: 'eye', name: 'VEIL', count: 1, at: v3(300, 40, 380), facing: back })
      // Their artillery lurks on its own side of the belt, firing across it at
      // what the swarm flushes out, which is the ambush the card describes.
      return enemyOf(w, { aggression: 0.6, skill: 0.55, period: 1.8 }, ['THORN'])
    },
  },

  {
    id: 'aegis',
    name: 'Under the Aegis',
    epigraph: 'Small arms against a screen is arithmetic you will lose.',
    brief: [
      'Their line is under an absorption field that refills faster than a needle can drain it.',
      'The field has a source. Kill the source and the arithmetic reverses.',
      'You have two sources of your own, and a field takes the same bite out of every bolt that crosses it: all of a needle\'s shot, and a rounding error off a shell. Sixteen of their needles cannot hurt what is standing under yours, and your artillery is not what needs the cover.',
    ],
    teaches: 'Aegis hulls project the screen you keep failing to break, and their line holds its ground under it. Break the sortie on your own guns first, then go in and put the sources out one at a time.',
    build(seed) {
      const w = shell({ kind: 'annihilate', text: 'Destroy the enemy fleet' }, seed, 0.6, 880)
      addBody(w, { kind: 'planet', name: 'Vault', pos: v3(-360, -120, 260), radius: 150, mu: 150 * 150 * 5 })
      addSquadron(w, { side: 'blue', cls: 'needle', name: BLUE[0], count: 16, at: v3(-90, 60, -400), facing: forward })
      addSquadron(w, { side: 'blue', cls: 'lance', name: BLUE[1], count: 6, at: v3(130, -40, -470), facing: forward })
      addSquadron(w, { side: 'blue', cls: 'aegis', name: BLUE[2], count: 2, at: v3(20, 20, -440), facing: forward })
      // Weighted toward needles rather than toward more screens. The field is what
      // makes small arms harmless, so massed needles are what a screen is actually
      // worth having: it forces blue's lances forward into needle range to reach
      // the aegis hulls, which is the trade the mission is asking about.
      addSquadron(w, { side: 'red', cls: 'needle', name: 'DRIFT', count: 16, at: v3(60, 40, 330), facing: back })
      addSquadron(w, { side: 'red', cls: 'lance', name: 'THORN', count: 4, at: v3(-90, -20, 440), facing: back })
      addSquadron(w, { side: 'red', cls: 'aegis', name: 'HUSK', count: 4, at: v3(0, 10, 390), facing: back })
      // The line under the field stands; the swarm sorties from it. A red that
      // marched the whole formation out gave up the screened position the
      // mission is named for and died on blue's guns in the open.
      return enemyOf(w, { aggression: 0.65, skill: 0.6, period: 1.7 }, ['THORN', 'HUSK'])
    },
  },

  {
    id: 'keel',
    name: 'The Bay Doors',
    epigraph: 'You are not fighting their hulls. You are fighting the thing that makes them.',
    brief: [
      'Two keels sit behind the ring, and every seven seconds another needle rolls out of a bay. Attrition is not a plan here.',
      'You do not have to sweep the volume. You have to get through their screen and put the keels out.',
      'Six of their lances hold high over the ring, covering the straight line to both bays. They out-range everything you own except your own guns, and like every heavy hull they are slow.',
    ],
    teaches: 'Objective: kill both keels. Their wings keep respawning until the bay doors close for good.',
    build(seed) {
      const w = shell(
        { kind: 'decapitate', targets: ['COIL', 'SPIRAL'], text: 'Destroy both enemy keels' },
        seed,
        0.7,
        920,
      )
      const giant = addBody(w, {
        kind: 'planet',
        name: 'Hollow',
        pos: v3(60, -40, 330),
        radius: 165,
        mu: 165 * 165 * 5.4,
      })
      addBody(w, {
        kind: 'ring',
        name: 'Hollow Ring',
        pos: giant.pos,
        radius: 420,
        normal: v3(0.25, 1, -0.1),
        thickness: 24,
      })
      // A lance heavy fleet, because this is the mission where lances are the point:
      // nine of them kill a keel through its own screen, and the needles and the field
      // are here to keep them alive long enough to do it. The fleet that shipped first
      // was fourteen needles and six lances, which cannot win: THORN one-shots a needle,
      // so a third of the points were food, and six guns cannot chew through 1400 hull
      // before the bays replace everything they lose. Forty eight runs of four plans put
      // one keel at 156 of 700 once and never closed a bay.
      addSquadron(w, { side: 'blue', cls: 'needle', name: BLUE[0], count: 10, at: v3(-120, 80, -420), facing: forward })
      addSquadron(w, { side: 'blue', cls: 'lance', name: BLUE[1], count: 9, at: v3(120, -20, -500), facing: forward })
      addSquadron(w, { side: 'blue', cls: 'aegis', name: BLUE[2], count: 3, at: v3(0, 40, -460), facing: forward })
      addSquadron(w, { side: 'blue', cls: 'eye', name: BLUE[3], count: 1, at: v3(-260, 140, -400), facing: forward })

      const coil = addSquadron(w, { side: 'red', cls: 'keel', name: 'COIL', count: 1, at: v3(-140, 30, 470), facing: back })
      const coilWing = addSquadron(w, { side: 'red', cls: 'needle', name: 'COIL WING', count: 5, at: v3(-140, 30, 430), facing: back })
      coil.wing = coilWing.id
      const spiral = addSquadron(w, { side: 'red', cls: 'keel', name: 'SPIRAL', count: 1, at: v3(240, -30, 540), facing: back })
      const spiralWing = addSquadron(w, { side: 'red', cls: 'needle', name: 'SPIRAL WING', count: 5, at: v3(240, -30, 500), facing: back })
      spiral.wing = spiralWing.id

      // Artillery holds high and wide of the giant, where it has clean sight
      // lines down onto anything crossing the ring toward the bays.
      addSquadron(w, { side: 'red', cls: 'lance', name: 'THORN', count: 6, at: v3(-40, 190, 300), facing: back })
      addSquadron(w, { side: 'red', cls: 'aegis', name: 'HUSK', count: 3, at: v3(-60, 20, 520), facing: back })
      // The defence defends: the keels are the bases, THORN is the overwatch the
      // brief describes, and the screen stays on the things it screens. Only the
      // bay wings sortie. Unreserved, the whole position marched at blue and the
      // mission stopped being about getting through anything.
      return enemyOf(w, { aggression: 0.7, skill: 0.65, period: 1.6 }, ['THORN', 'HUSK', 'COIL', 'SPIRAL'])
    },
  },

  {
    id: 'overwhelm',
    name: 'Overwhelm',
    epigraph: 'The numbers are not a mistake. Fight anyway.',
    brief: [
      'Three to one against, and they are coming from two axes. Nobody expects you to sweep this volume.',
      'Almost every hull in that mass carries a needle gun and nothing heavier, so your screens will bite every shot they take. Thirty six guns will empty them anyway.',
      'The order says hold the volume for a minute and a half. It does not say hold still, and there are nine hundred units of it. Give ground on posts, H at a point behind the fleet, and the wings fall back shooting. A move order is the other retreat, full burn and guns silent, and a fleet that runs silent from this many needles is run down.',
      'JOHNSON carries the charge and JOHNSON has no guns. That is deliberate: the cascade walks three and a half times as far as you can throw it, so whoever releases it is standing in the burst.',
    ],
    // The device and nothing else, on the mission that already asks the player to read
    // four paragraphs. The two sentences of terrain this card used to carry re-taught the
    // moon from the second mission and the debris belt from Shoal, and pointed at Anvil
    // while doing it, which is the plan that loses: giving ground holds 12 runs in 12,
    // standing behind Anvil holds 5, and standing still holds 1, because a rock that
    // blocks fire also pins you against something red can englobe.
    teaches:
      'Press E with a carrying squadron selected, then click a target: the panel counts what the cascade takes, and says how far your nearest hull is from the burst against how far the burst walks.',
    build(seed) {
      /*
       * Ninety seconds, because that is how long the mission is a fight. Every one of red's
       * thirty six needles is dead between 39 and 47 seconds, and what is left is eight
       * lances at speed thirty and four screens, none of which can catch a fleet that flies
       * at fifty eight. The clock's only remaining job past that point is to kill the plans
       * that plant themselves, and it finishes that job here: giving ground holds twelve runs
       * of twelve, standing still holds one, and hiding behind Anvil holds five. The 145 this
       * replaced separated the same three plans no better (12, 1 and 1) and spent the extra
       * fifty five seconds on eight lances plodding after twenty hulls they cannot reach, a
       * stretch in which one seed killed nothing at all on either side.
       */
      const w = shell({ kind: 'survive', seconds: 90, text: 'Hold the volume for 90 seconds' }, seed, 0.8, 940)
      addBody(w, { kind: 'planet', name: 'Anvil', pos: v3(0, -260, 120), radius: 170, mu: 170 * 170 * 5.6 })
      addBody(w, {
        kind: 'field',
        name: 'Scree',
        pos: v3(-300, 60, 200),
        radius: 260,
        normal: v3(0, 1, 0.4),
        thickness: 80,
      })
      // The charge rides with the two scouts, which is this battle's whole lesson about
      // who carries one. Release range is 130 and the cascade walks 455, so the wing
      // that lets go of a charge is standing inside the burst. Given to the fourteen
      // needles, the wing that does blue's shooting has to close to release range to
      // use it, and the chain then walks back up its own formation: it took eighteen
      // of red and thirteen of blue's twenty five, and the mission fell from twelve
      // runs in twelve to eight with a quarter of the fleet left. On the eyes the same
      // charge takes the same eighteen and costs two hulls that own no guns. That the
      // eye is also the fastest thing blue owns is what makes it the courier, since
      // carrying costs a wing a third of its speed.
      addSquadron(w, { side: 'blue', cls: 'needle', name: BLUE[0], count: 14, at: v3(-60, 60, -420), facing: forward })
      addSquadron(w, { side: 'blue', cls: 'lance', name: BLUE[1], count: 6, at: v3(90, -30, -500), facing: forward })
      addSquadron(w, { side: 'blue', cls: 'aegis', name: BLUE[2], count: 3, at: v3(10, 20, -450), facing: forward })
      addSquadron(w, { side: 'blue', cls: 'eye', name: BLUE[3], count: 2, at: v3(-240, 120, -390), facing: forward, device: 1 })

      addSquadron(w, { side: 'red', cls: 'needle', name: 'SHOAL', count: 18, at: v3(-260, 120, 380), facing: back, scatter: 44 })
      addSquadron(w, { side: 'red', cls: 'needle', name: 'DRIFT', count: 18, at: v3(300, -80, 400), facing: back, scatter: 44 })
      addSquadron(w, { side: 'red', cls: 'lance', name: 'THORN', count: 8, at: v3(40, 30, 520), facing: back })
      addSquadron(w, { side: 'red', cls: 'aegis', name: 'HUSK', count: 4, at: v3(0, 0, 470), facing: back })
      addSquadron(w, { side: 'red', cls: 'eye', name: 'VEIL', count: 2, at: v3(420, 60, 300), facing: back })
      return enemyOf(w, { aggression: 0.8, skill: 0.7, period: 1.5 })
    },
  },

  {
    id: 'last-exam',
    name: 'The Last Exam',
    epigraph: 'This is the last time I will watch you work. Make it worth watching.',
    brief: [
      'Their homeworld, its ring, and everything they have left between you and it. The comm delay is over a second: order a thing and it happens later, somewhere else.',
      'You cannot win this by killing their fleet. There is more fleet than you have ammunition.',
      'HAMILTON carries both charges, and a wing that is carrying flies at seven tenths of its speed. Send it off with the fleet and it arrives out front and alone, ahead of everything that was meant to be shot at instead of it. Send it a quarter of a minute later and it arrives while the garrison is busy.',
      'They carry the device too. Keep your hulls apart.',
    ],
    teaches: 'There is one target in this volume that ends the battle, and the device has to be carried within reach of it.',
    build(seed) {
      // Twice the depth of any other battle, and the depth is the difficulty. A
      // needle crosses six hundred units in ten seconds, so a shallow theatre hands
      // the win to whoever points a fast squadron at the planet first: the enemy's
      // numbers only ever matter if the run in lasts long enough for them to be
      // brought to bear. Here it is a thousand units to the release shell, through
      // everything they own.
      const w = createWorld(seed, { kind: 'unmake', body: 0, text: 'Unmake the homeworld' }, 1600)
      w.commLag = 1.25
      const home = addBody(w, {
        kind: 'planet',
        name: 'Hive',
        pos: v3(0, 0, 790),
        radius: 175,
        mu: 175 * 175 * 5.8,
        consumable: true,
      })
      w.objective.body = home.id
      addBody(w, {
        kind: 'ring',
        name: 'Hive Ring',
        pos: home.pos,
        radius: 470,
        normal: v3(0.18, 1, -0.06),
        thickness: 28,
      })
      // Both of these sit in the corridor rather than beside it. A moon to come
      // around and a debris field to cross are the two pieces of cover on the way
      // in, and a run that uses neither is a run made in the open.
      addBody(w, { kind: 'moon', name: 'Watch', pos: v3(-340, 120, 330), radius: 60 })
      addBody(w, {
        kind: 'field',
        name: 'Wrack',
        pos: v3(300, -90, 210),
        radius: 300,
        normal: v3(0.2, 1, 0.3),
        thickness: 88,
      })

      addSquadron(w, { side: 'blue', cls: 'needle', name: BLUE[0], count: 16, at: v3(-120, 70, -520), facing: forward })
      // The runner: expendable, and holding the only thing that matters. Both charges
      // ride on one wing rather than being split with JOHNSON's eyes, which is a
      // deliberately worse deal than the alternative. Split, the two couriers come in
      // on separate vectors at different speeds and the garrison can only answer one:
      // that wins twenty three of twenty four with nine hulls still standing, against
      // twenty of twenty four and one hull standing here. The mission is the last one
      // and it is supposed to cost the fleet, so the harder roster is the right one.
      // Note that these are needles, not the eyes Overwhelm taught you to send: they
      // are slower even before the charge slows them, and they are ten hulls of blue's
      // shooting spent on delivery. That is the exam's arithmetic rather than an
      // oversight, and the brief says so.
      addSquadron(w, { side: 'blue', cls: 'needle', name: BLUE[4], count: 10, at: v3(-30, -70, -600), facing: forward, device: 2 })
      addSquadron(w, { side: 'blue', cls: 'lance', name: BLUE[1], count: 8, at: v3(140, -30, -580), facing: forward })
      addSquadron(w, { side: 'blue', cls: 'aegis', name: BLUE[2], count: 3, at: v3(20, 30, -540), facing: forward })
      addSquadron(w, { side: 'blue', cls: 'eye', name: BLUE[3], count: 2, at: v3(-280, 150, -480), facing: forward })

      // Three layers, and the spacing between them is the puzzle. A charge has to
      // be released inside a shell a hundred and thirty units off the skin, so the
      // only geometry that matters is what can shoot into that shell. Stacking the
      // whole fleet against the planet would leave it all standing behind the
      // release point, which is worse than useless: it would be a wall with the
      // door already on the far side of it.
      //
      // So the fleet is out front where it will meet ours, in the open, and it is
      // the garrison alone that holds the shell.
      addSquadron(w, { side: 'red', cls: 'needle', name: 'SHOAL', count: 20, at: v3(-260, 70, -60), facing: back, scatter: 46 })
      addSquadron(w, { side: 'red', cls: 'needle', name: 'DRIFT', count: 20, at: v3(250, -60, -20), facing: back, scatter: 46 })
      // SWARM sits high over the middle of the corridor, which is the one place from
      // which it can reach any lane before a carrier has finished crossing. Its size
      // was cut to ten for a while on the strength of a sweep that said sixteen made
      // the mission unwinnable, and the sweep was wrong: what made it unwinnable was
      // a scoring bug that read an unmade homeworld as a defeat whenever the cascade
      // took blue's last hulls with it. Swept again afterwards, sixteen wins twenty
      // runs of twenty four and ten wins twenty three, so the wing is back to the size
      // the corridor wants and the balance rests on the timing instead.
      addSquadron(w, { side: 'red', cls: 'needle', name: 'SWARM', count: 16, at: v3(0, 210, 300), facing: back, scatter: 46 })
      // TAPER is the hive doing what Overwhelm taught you to do, and it is the last
      // thing the campaign has to say. Two unarmed scouts carry the charge, because
      // release range is a quarter of the walk and whoever lets go of one is standing
      // in it: a charge on SWARM's sixteen needles, which is where this used to sit,
      // could only be used from inside a melee and came to one red hull spent per
      // eight tenths of a blue one. On the scouts the same charge is aimed at whatever
      // blue has bunched up, and the fleet blue bunches up is the one holding the
      // garrison's attention. That is the mission's last question: the concentration
      // that buys the run in is also the target.
      addSquadron(w, { side: 'red', cls: 'eye', name: 'TAPER', count: 2, at: v3(120, 240, 420), facing: back, device: 1 })

      // The garrison, and THORN is the reason the run in costs something. Artillery
      // reaches two hundred and forty, further than a charge is thrown, so parked
      // just off the skin it covers the whole near face of the shell: there is no
      // angle onto this planet that a lance is not already looking down. It cannot
      // chase, though, which is the door. Blow it open, or spend the fleet holding
      // its attention, but the last four seconds of the run belong to somebody.
      //
      // It carries no charge. It held one for a while, which was dead weight: a
      // garrison is reserved to its station, and a wing that never leaves station
      // never carries anything into reach of a target.
      addSquadron(w, { side: 'red', cls: 'lance', name: 'THORN', count: 10, at: v3(0, 40, 560), facing: back })
      addSquadron(w, { side: 'red', cls: 'aegis', name: 'HUSK', count: 5, at: v3(0, -180, 585), facing: back })
      const coil = addSquadron(w, { side: 'red', cls: 'keel', name: 'COIL', count: 2, at: v3(-200, 110, 640), facing: back })
      const coilWing = addSquadron(w, { side: 'red', cls: 'needle', name: 'COIL WING', count: 6, at: v3(220, 130, 650), facing: back })
      coil.wing = coilWing.id

      // Two watchtowers over the homeworld, high and low, each covering the
      // hemisphere the other cannot. They are why a wing cannot simply walk in
      // from an unwatched angle, and killing one opens that angle back up.
      addSquadron(w, { side: 'red', cls: 'eye', name: 'VEIL', count: 1, at: v3(-40, 310, 700), facing: back })
      addSquadron(w, { side: 'red', cls: 'eye', name: 'MOTE', count: 1, at: v3(60, -300, 840), facing: back })

      return enemyOf(w, { aggression: 0.85, skill: 0.8, period: 1.4, deviceThreshold: 8 }, [
        'THORN',
        'HUSK',
        'COIL',
        'COIL WING',
        'VEIL',
        'MOTE',
      ])
    },
  },
]

export const scenarioById = (id: string): Scenario | undefined => SCENARIOS.find((s) => s.id === id)

export function fleetRatio(w: World): string {
  const blue = fleetStrength(w, 'blue')
  const red = fleetStrength(w, 'red')
  const ratio = red / Math.max(1, blue)
  return `${blue} vs ${red} points (1 : ${ratio.toFixed(2)})`
}
