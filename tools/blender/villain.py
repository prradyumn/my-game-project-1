# The Asuras' bodies, sculpted in code (Blender 5): a demon's anatomy built as metaball muscle
# masses along the crowd body's own skeleton (Rocketbox Male_Adult_11, the one every Asura motion
# drives), fused into one surface, remeshed, given horns / tusks / claws / spines / armour, baked
# (normal + cavity from the detailed sculpt onto the game mesh), skinned to that skeleton by
# Blender's bone heat and exported as a GLB. The motions are carried across afterwards by
# tools/bake-villains.mjs (the game's own retarget), so the skeleton's proportions may change.
#
#   blender -b -P tools/blender/villain.py -- <villain> <out.glb> [--preview <prefix>] [--fast]
#
# Villains: see VILLAINS below. Coordinates: metres, Z up, facing -Y (Blender's front).
import bpy, bmesh, sys, math, os
from mathutils import Vector, Matrix, Quaternion
import random

ARGS = sys.argv[sys.argv.index('--') + 1:]
NAME = ARGS[0]
OUT = ARGS[1]
PREVIEW = ARGS[ARGS.index('--preview') + 1] if '--preview' in ARGS else None
FAST = '--fast' in ARGS
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
FBX = os.path.join(ROOT, 'source-assets/rocketbox/Male_Adult_11/Male_Adult_11.fbx')
K = 0.779  # metaball surface radius / element radius (stiffness 10, threshold 0.6: blends only near the surface)
FWD = Vector((0, -1, 0))
UP = Vector((0, 0, 1))

# ---------------------------------------------------------------- the villains
# len: bone length factors (the segment from a bone's head to its children);
# m: muscle sizes (1 = an athletic man); details switch features on.
VILLAINS = {
    # Rakshasa: a hulking man-eater. Massive shoulders and traps, a thick neck sunk between them,
    # long heavy arms, clawed hands, curling ram horns and tusks, a heavy brow over deep sockets.
    'rakshasa': dict(
        len={'Clavicle': 1.35, 'UpperArm': 1.12, 'Forearm': 1.12, 'Hand': 1.15, 'Finger': 1.25, 'Neck': 0.55, 'Spine2': 1.1},
        m=dict(chest=1.5, belly=1.15, traps=2.0, delt=1.6, arm=1.55, fore=1.5, thigh=1.6, calf=1.5, neck=1.8, glute=1.0, abs=1.1, lat=1.5),
        skull=1.05, jaw=1.35, brow=1.4, snout=0.6, ears=1.0, socket=1.0,
        horns=dict(kind='bull', length=0.46, radius=0.072), tusks=dict(length=0.13, radius=0.018),
        claws=0.07, toeclaws=0.05, spikes=0, ribs=0, belt=True, beads=True, armour=None,
        displace=dict(cloud=0.006, crack=0.004), cloth='loin', faces=20000,
    ),
    # Chhaya, the shade: the common Asura. Gaunt and long-limbed, ash-dark, swept-back horns and a
    # ridge of spines down the back, long clawed fingers. Many come at once: a light mesh.
    'chhaya': dict(
        len={'UpperArm': 1.14, 'Forearm': 1.16, 'Hand': 1.1, 'Finger': 1.35, 'Neck': 1.1},
        m=dict(chest=1.0, belly=0.75, traps=1.05, delt=1.0, arm=0.95, fore=0.95, thigh=0.95, calf=0.95, neck=0.9, glute=0.75, abs=1.05, lat=1.0),
        skull=0.95, jaw=1.0, brow=1.2, snout=0.2, ears=1.2, socket=1.15,
        horns=dict(kind='swept', length=0.36, radius=0.032), tusks=None,
        claws=0.085, toeclaws=0.04, spikes=dict(n=7, length=0.07), ribs=0, armour=None,
        displace=dict(cloud=0.005, crack=0.005), faces=13000,
    ),
    # Pishacha, the flesh-eater: starved to the bone, ribs and a hollow belly, a long skull, a long
    # narrow jaw, long bony fingers (it hurls ghost-fire).
    'pishacha': dict(
        len={'UpperArm': 1.12, 'Forearm': 1.15, 'Hand': 1.15, 'Finger': 1.5, 'Neck': 1.25},
        m=dict(chest=0.8, belly=0.5, traps=0.75, delt=0.72, arm=0.65, fore=0.7, thigh=0.72, calf=0.7, neck=0.65, glute=0.6, abs=0.5, lat=0.7),
        skull=1.0, jaw=0.9, brow=1.0, snout=0.0, ears=1.4, socket=1.35, crlen=1.3, jawlen=1.4,
        horns=dict(kind='nubs', length=0.06, radius=0.022), tusks=None,
        claws=0.1, toeclaws=0.035, spikes=None, ribs=7, armour=None,
        displace=dict(cloud=0.004, crack=0.006), faces=13000,
    ),
    # Kavacha, the armoured: an Asura warrior in bronze: a horned helm, pauldrons, a breastplate,
    # bracers, a belt, greaves (and the game's shield on its arm).
    'kavacha': dict(
        len={'Clavicle': 1.15, 'UpperArm': 1.05, 'Forearm': 1.05, 'Finger': 1.15},
        m=dict(chest=1.2, belly=1.0, traps=1.3, delt=1.25, arm=1.2, fore=1.2, thigh=1.2, calf=1.15, neck=1.3, glute=1.0, abs=1.0, lat=1.2),
        skull=1.0, jaw=1.15, brow=1.3, snout=0.3, ears=0.9, socket=1.0,
        horns=None, tusks=dict(length=0.07, radius=0.012),
        claws=0.04, toeclaws=0.03, spikes=None, ribs=0, armour=True,
        displace=dict(cloud=0.005, crack=0.004), faces=16000,
    ),
    # Vetala, the corpse-rider: a leaper. Wasted, very long arms and talons, great bat ears, a spined
    # back, no horns: it clings to walls and drops on him.
    'vetala': dict(
        len={'UpperArm': 1.2, 'Forearm': 1.25, 'Hand': 1.2, 'Finger': 1.6, 'Neck': 1.15},
        m=dict(chest=0.88, belly=0.6, traps=0.9, delt=0.85, arm=0.78, fore=0.8, thigh=0.82, calf=0.8, neck=0.75, glute=0.65, abs=0.75, lat=0.85),
        skull=0.98, jaw=1.05, brow=1.1, snout=0.5, ears=2.2, bat=True, socket=1.25, crlen=1.1,
        horns=None, tusks=None,
        claws=0.12, toeclaws=0.06, spikes=dict(n=9, length=0.06), ribs=4, armour=None,
        displace=dict(cloud=0.005, crack=0.006), faces=13000,
    ),
    # Andhaka, the Blind Darkness: a four-armed giant (the second pair below the first), a crown
    # of horns, empty sockets, a loincloth and bronze at the wrists and waist.
    'andhaka': dict(
        len={'Clavicle': 1.3, 'UpperArm': 1.1, 'Forearm': 1.1, 'Hand': 1.15, 'Finger': 1.25, 'Neck': 0.7},
        m=dict(chest=1.45, belly=1.15, traps=1.7, delt=1.5, arm=1.45, fore=1.4, thigh=1.45, calf=1.35, neck=1.6, glute=1.0, abs=1.1, lat=1.45),
        skull=1.05, jaw=1.25, brow=1.5, snout=0.3, ears=0.8, socket=1.5, blind=True, arms2=True,
        horns=dict(kind='crown', length=0.3, radius=0.035), tusks=dict(length=0.1, radius=0.015),
        claws=0.08, toeclaws=0.05, spikes=dict(n=6, length=0.09), ribs=0, armour='bracers', cloth='loin',
        displace=dict(cloud=0.006, crack=0.005), faces=26000,
    ),
}

V = VILLAINS[NAME]


# ---------------------------------------------------------------- the skeleton
def load_rig():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=FBX)
    arm = next(o for o in bpy.context.scene.objects if o.type == 'ARMATURE')
    for o in list(bpy.context.scene.objects):
        if o is not arm:
            bpy.data.objects.remove(o, do_unlink=True)
    # (the FBX's take keys the object's own 0.01 scale: it would come back over the applied one)
    arm.animation_data_clear()
    for b in arm.pose.bones:
        b.location = (0, 0, 0)
        b.rotation_quaternion = (1, 0, 0, 0)
        b.scale = (1, 1, 1)
    # metres, scale 1 (the FBX armature carries 0.01)
    bpy.context.view_layer.objects.active = arm
    arm.select_set(True)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    return arm


FACIAL = ('Eye', 'Jaw', 'Lip', 'Tongue', 'Mouth', 'Masseter', 'Caninus', 'Cheek', 'Eyebrow', 'Nose', 'Blink', 'Upperlip')


def edit_proportions(arm):
    """Lengthen / shorten bone segments: each bone's children (and their whole chains) move
    with the bone's scaled offset; tails follow."""
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode='EDIT')
    eb = arm.data.edit_bones
    # the facial rig is not needed (no clip drives it): gone, so the bone heat ignores it
    for b in list(eb):
        if any(f in b.name for f in FACIAL):
            eb.remove(b)
    if V.get('arms2'):
        # a second pair of arms: copies of the arm chains, a hand's breadth below and behind the
        # first, from the chest (the game moves them after the first pair)
        for side in ('L', 'R'):
            chain = []
            stack = [eb[f'Bip01 {side} UpperArm']]
            while stack:
                b = stack.pop()
                chain.append(b)
                stack.extend(b.children)
            made = {}
            for b in chain:
                c = eb.new(b.name.replace(f'Bip01 {side} ', f'Bip01 {side}2 '))
                off = Vector((0.0, 0.03, -0.17))
                c.head = b.head + off
                c.tail = b.tail + off
                c.roll = b.roll
                made[b.name] = c
            for b in chain:
                made[b.name].parent = made[b.parent.name] if b.parent.name in made else eb['Bip01 Spine1']
    old = {b.name: (b.head.copy(), b.tail.copy()) for b in eb}

    def factor(name):
        for key, f in V['len'].items():
            if key in name and (key != 'Finger' or 'Finger' in name):
                return f
        return 1.0

    def walk(b, new_head):
        oh, ot = old[b.name]
        f = factor(b.name)
        b.head = new_head
        b.tail = new_head + (ot - oh) * f
        for c in b.children:
            ch, _ = old[c.name]
            walk(c, new_head + (ch - oh) * f)

    root = next(b for b in eb if b.parent is None)
    walk(root, old[root.name][0])
    bpy.ops.object.mode_set(mode='OBJECT')


def joints(arm):
    P = {}
    for b in arm.data.bones:
        P[b.name.replace('Bip01 ', '').replace(' ', '')] = arm.matrix_world @ b.head_local
    return P


# ---------------------------------------------------------------- metaball sculpting
class Sculpt:
    def __init__(self, res):
        self.mb = bpy.data.metaballs.new('body')
        self.mb.resolution = res
        self.mb.threshold = 0.6
        self.obj = bpy.data.objects.new('body', self.mb)
        bpy.context.scene.collection.objects.link(self.obj)

    def frame(self, u, fwd=FWD):
        u = u.normalized()
        f = (fwd - u * fwd.dot(u))
        if f.length < 1e-4:
            f = Vector((0, 0, 1)) - u * u.z
        f.normalize()
        s = u.cross(f)
        return Matrix((u, f, s)).transposed()  # columns: local X=u, Y=f, Z=s

    def ell(self, c, a, b, d, rot=None, neg=False, stiff=10.0):
        """An ellipsoid with semi-axes a (local X), b (Y), d (Z)."""
        R = max(a, b, d) / K
        e = self.mb.elements.new(type='ELLIPSOID')
        e.co = c
        e.radius = R
        e.size_x, e.size_y, e.size_z = a / (K * R), b / (K * R), d / (K * R)
        e.stiffness = stiff
        e.use_negative = neg
        if rot is not None:
            e.rotation = rot.to_quaternion()
        return e

    def cap(self, p, q, r, neg=False, stiff=10.0):
        """A capsule from p to q, radius r."""
        d = q - p
        e = self.mb.elements.new(type='CAPSULE')
        e.co = (p + q) / 2
        e.radius = r / K
        e.size_x = max(1e-4, d.length / 2)
        e.stiffness = stiff
        e.use_negative = neg
        e.rotation = self.frame(d).to_quaternion()
        return e

    def along(self, p, q, t, off=(0, 0, 0), fwd=FWD):
        """A point t of the way from p to q, offset in that segment's frame (along, front, side)."""
        M = self.frame(q - p, fwd)
        return p.lerp(q, t) + M @ Vector(off), M

    def mesh(self):
        bpy.context.view_layer.objects.active = self.obj
        for o in bpy.context.selected_objects:
            o.select_set(False)
        self.obj.select_set(True)
        bpy.ops.object.convert(target='MESH')
        return bpy.context.view_layer.objects.active


def sculpt_body(P, res):
    S = Sculpt(res)
    m = V['m']
    pel, sp, sp1, sp2, neck, head = P['Pelvis'], P['Spine'], P['Spine1'], P['Spine2'], P['Neck'], P['Head']
    up = (head - pel).normalized()
    # ---- torso: the ribcage, the chest, the belly, the back
    chestC = sp2.lerp(sp1, 0.35) + FWD * 0.02
    S.ell(chestC, 0.15 * max(m['chest'], 0.9), 0.115 * m['chest'] ** 0.8, 0.19, S.frame(Vector((1, 0, 0))))  # X across, Y front, Z up
    for sx in (-1, 1):
        # pectorals: two slabs over the front of the ribs
        c = sp2 + Vector((0.085 * sx * m['chest'] ** 0.7, -0.085 * m['chest'] ** 0.75, 0.01))
        S.ell(c, 0.1 * m['chest'] ** 0.8, 0.024 * m['chest'] ** 1.2, 0.06 * m['chest'] ** 0.8, S.frame(Vector((sx, 0, -0.12))))
        # lats: wings down the back from the armpit
        c = sp1.lerp(sp2, 0.5) + Vector((0.11 * sx * m['lat'] ** 0.6, 0.05 * min(1, m['lat']) ** 1.5, 0))
        S.ell(c, 0.05 * m['lat'], 0.07 * min(1, m['lat']) ** 1.5, 0.13, S.frame(Vector((sx, 0.3, 0))))
        # obliques, glutes
        fr = m['thigh'] ** 0.5
        S.ell(sp.lerp(pel, 0.4) + Vector((0.115 * sx * fr, -0.01, 0.02)), 0.055 * fr, 0.075 * fr, 0.1)
        S.ell(pel + Vector((0.075 * sx, 0.055 * m['glute'] ** 0.5, -0.06)), 0.085 * m['glute'], 0.065 * m['glute'] ** 0.6, 0.095 * m['glute'])
    # the belly and the abdominals (a 3 x 2 grid of slabs)
    S.ell(sp.lerp(sp1, 0.5) + FWD * 0.03, 0.13 * m['belly'], 0.105 * m['belly'], 0.14)
    for row in range(3):
        for sx in (-1, 1):
            c = sp.lerp(sp2, 0.12 + row * 0.27) + Vector((0.038 * sx, -0.11 * m['belly'], -0.02))
            S.ell(c, 0.035 * m['abs'], 0.022 * m['abs'], 0.045)
    S.ell(pel + Vector((0, 0.025, 0.03)), 0.15 * m['thigh'] ** 0.5, 0.095 * m['glute'] ** 0.5, 0.1)  # the pelvis (set back: no bulge in front)
    # ---- neck and traps (a brute's head sits down between them)
    S.cap(sp2.lerp(neck, 0.4), head + up * 0.02, 0.055 * max(m['neck'], 0.85))
    # the neck's cords: from behind each ear down to the top of the breastbone
    for sx in (-1, 1):
        S.cap(head + Vector((0.045 * sx, 0.01, 0.03)), sp2 + Vector((0.02 * sx, -0.07, 0.06)), 0.018 * max(m['neck'], 0.8) ** 0.5)
    # the trapezius: a mound behind the neck, rising toward the skull (a brute's hunch)
    S.ell(neck + Vector((0, 0.06, -0.02)), 0.11 * m['traps'] ** 0.6, 0.06 * m['traps'] ** 0.7, 0.09 * m['traps'] ** 0.6)
    for sx in (-1, 1):
        cl = P['LClavicle' if sx > 0 else 'RClavicle']
        sh = P['LUpperArm' if sx > 0 else 'RUpperArm']
        S.cap(neck + up * 0.03 + Vector((0.03 * sx, 0.03, 0)), sh.lerp(cl, 0.35) + up * 0.02, 0.05 * m['traps'] ** 0.7)
    # ---- the arms (and a second pair below them)
    for s in ('L', 'R') + (('L2', 'R2') if V.get('arms2') else ()):
        sx = 1 if s == 'L' else -1
        sh, el, wr = P[s + 'UpperArm'], P[s + 'Forearm'], P[s + 'Hand']
        # the deltoid capping the shoulder
        c, M = S.along(sh, el, 0.08, (0, 0, 0))
        S.ell(c + up * 0.01, 0.08 * m['delt'], 0.065 * m['delt'], 0.07 * m['delt'], M)
        # the upper arm, the biceps in front and the triceps behind
        S.cap(sh, el, 0.042 * max(m['arm'], 0.85) ** 0.6)
        c, M = S.along(sh, el, 0.55, (0, -0.025 * m['arm'], 0))
        S.ell(c, 0.09 * m['arm'] ** 0.8, 0.04 * m['arm'], 0.045 * m['arm'], M)
        c, M = S.along(sh, el, 0.45, (0, 0.03 * m['arm'], 0))
        S.ell(c, 0.1 * m['arm'] ** 0.8, 0.042 * m['arm'], 0.045 * m['arm'], M)
        # the forearm, heavy at the elbow, down to a wrist
        S.cap(el, wr, 0.032 * max(m['fore'], 0.85) ** 0.5)
        c, M = S.along(el, wr, 0.3, (0, 0, 0))
        S.ell(c, 0.09 * m['fore'] ** 0.7, 0.042 * m['fore'], 0.047 * m['fore'], M)
        # the hand: a palm, the fingers phalanx by phalanx, a claw on each
        knuckles = [P[f'{s}Finger{i}'] for i in (1, 2, 3, 4)]
        palm = sum(knuckles, Vector()) / 4
        S.cap(wr, palm, 0.03 * m['fore'] ** 0.4)
        c, M = S.along(wr, palm, 0.5, (0, 0, 0))
        S.ell(c, 0.045, 0.022, 0.045 * m['fore'] ** 0.3, M)
        for i in range(5):
            a, b, cc = P[f'{s}Finger{i}'], P[f'{s}Finger{i}1'], P[f'{s}Finger{i}2']
            tip = cc + (cc - b) * 1.15
            r = 0.012 * m['fore'] ** 0.35 * (1.15 if i == 0 else 1)
            S.cap(a, b, r)
            S.cap(b, cc, r * 0.9)
            S.cap(cc, tip, r * 0.8)
    # ---- the ribs, standing out of a starved chest
    for i in range(V.get('ribs', 0)):
        dz = 0.1 - i * 0.034
        k = math.sqrt(max(0.05, 1 - (dz / 0.2) ** 2)) * 1.03
        a, b = 0.15 * m['chest'] * k, 0.115 * m['chest'] ** 0.8 * k
        for sx in (-1, 1):
            pts = []
            for j in range(7):
                ph = 0.18 + j * 0.24
                pts.append(chestC + Vector((sx * a * math.sin(ph), -b * math.cos(ph), dz - 0.035 * (1 - j / 6))))
            for j in range(6):
                S.cap(pts[j], pts[j + 1], 0.0085)
    # ---- the legs
    for s in ('L', 'R'):
        hip, kn, an, toe = P[s + 'Thigh'], P[s + 'Calf'], P[s + 'Foot'], P[s + 'Toe0']
        S.cap(hip, kn, 0.062 * max(m['thigh'], 0.85) ** 0.8)
        c, M = S.along(hip, kn, 0.45, (0, -0.03 * m['thigh'], 0))
        S.ell(c, 0.17 * m['thigh'] ** 0.6, 0.06 * m['thigh'], 0.065 * m['thigh'], M)  # quads
        c, M = S.along(hip, kn, 0.4, (0, 0.035 * m['thigh'], 0))
        S.ell(c, 0.15 * m['thigh'] ** 0.6, 0.055 * m['thigh'], 0.06 * m['thigh'], M)  # hamstrings
        S.ell(kn, 0.04 * m['thigh'] ** 0.4, 0.04 * m['thigh'] ** 0.4, 0.04 * m['thigh'] ** 0.4)  # the knee
        S.cap(kn, an, 0.042 * max(m['calf'], 0.85) ** 0.7)
        c, M = S.along(kn, an, 0.3, (0, 0.035 * m['calf'], 0))
        S.ell(c, 0.11 * m['calf'] ** 0.6, 0.05 * m['calf'], 0.05 * m['calf'], M)  # the calf
        # a demon's foot: a long heel-to-toe pad and three clawed toes
        heel = an + Vector((0, 0.03, -0.07))
        ball = toe + Vector((0, 0.0, -0.01))
        S.cap(heel, ball, 0.04)
        S.ell(an + Vector((0, 0, -0.03)), 0.045, 0.05, 0.05)
        fdir = (ball - heel).normalized()
        side = fdir.cross(UP).normalized()
        for k in (-1, 0, 1):
            base = ball + side * 0.025 * k
            S.cap(base, base + fdir * 0.06 + side * 0.012 * k + Vector((0, 0, -0.012)), 0.017)
    return S


def sculpt_head(S, P):
    """The skull: a long cranium, a heavy brow over deep sockets, a broad flat nose, a heavy
    jutting jaw split by a wide mouth, pointed ears swept back."""
    h = P['Head']
    nk = P['Neck']
    up = (h - nk).normalized()
    sk, jw, br = V['skull'], V['jaw'], V['brow']
    c = h + up * 0.1 + Vector((0, 0.01, 0))
    X = S.frame(Vector((1, 0, 0)))  # local X across, Y = front (-Y world), Z up
    cl = V.get('crlen', 1.0)  # (a long skull, swept back)
    S.ell(c + Vector((0, 0.01, 0.01)) * sk, 0.082 * sk, 0.1 * sk, 0.095 * sk, X)  # cranium
    S.ell(c + Vector((0, 0.055 * cl, 0.02 * (cl - 1) * 3)) * sk, 0.075 * sk, 0.075 * sk * cl, 0.08 * sk, X)  # the back of the skull
    # the brow: an angry V, two heavy ridges from the temples down to a knot between the eyes
    for sx in (-1, 1):
        S.cap(c + Vector((0.07 * sx, -0.075, 0.02)) * sk, c + Vector((0.012 * sx, -0.097, -0.012)) * sk, 0.017 * br)
    S.cap(c + Vector((0, -0.095, -0.01)) * sk, c + Vector((0, -0.07, 0.07)) * sk, 0.011 * br)  # a crest up the forehead
    for sx in (-1, 1):
        # cheekbones: hard ledges under the eyes, angled back toward the ears
        S.cap(c + Vector((0.03 * sx, -0.088, -0.055)) * sk, c + Vector((0.075 * sx, -0.04, -0.045)) * sk, 0.014)
        # the eye sockets, deep under the brow (the coal eyes burn in them)
        S.ell(c + Vector((0.034 * sx, -0.094, -0.03)) * sk, 0.022 * V['socket'], 0.024, 0.014 * V['socket'], X, neg=True)
        # pointed ears swept back
        e0 = c + Vector((0.08 * sx, 0.015, -0.03)) * sk
        if V.get('bat'):
            # great bat ears: a broad leaf out and up from the side of the head
            tip = e0 + Vector((0.07 * sx, 0.02, 0.1)) * V['ears'] * 0.6
            S.ell(e0.lerp(tip, 0.5), 0.022, 0.012, 0.075 * V['ears'] * 0.6, S.frame(tip - e0, Vector((sx, 0, 0))))
            S.cap(e0, tip, 0.008)
        else:
            S.cap(e0, e0 + Vector((0.045 * sx, 0.075, 0.06)) * V['ears'], 0.011)
        # the jawline: from under the ear down to the chin, a hard edge
        jl = V.get('jawlen', 1.0)
        S.cap(c + Vector((0.07 * sx * jw ** 0.5, -0.02, -0.09)) * sk, c + Vector((0.022 * sx, -0.1 * jw ** 0.3, -0.09 - 0.07 * jl)) * sk, 0.02 * jw)
    # a flat, broad nose (no bridge), flared nostrils carved in
    S.ell(c + Vector((0, -0.108 - 0.012 * V['snout'], -0.068)) * sk, 0.024, 0.013 + 0.008 * V['snout'], 0.024, X)
    for sx in (-1, 1):
        S.ell(c + Vector((0.012 * sx, -0.118 - 0.012 * V['snout'], -0.082)) * sk, 0.007, 0.009, 0.005, X, neg=True)
    # the muzzle under the nose, and a square chin
    S.ell(c + Vector((0, -0.095, -0.105)) * sk, 0.045 * jw, 0.025, 0.03, X)
    S.ell(c + Vector((0, -0.1 * jw ** 0.3, -0.088 - 0.07 * V.get('jawlen', 1.0))) * sk, 0.03 * jw, 0.022, 0.022, X)
    # the mouth: a wide cut, a little open (the fangs and tusks show in it)
    S.ell(c + Vector((0, -0.118, -0.122)) * sk, 0.042 * jw, 0.03, 0.007, X, neg=True)
    return c


# ---------------------------------------------------------------- hard parts (bmesh)
def horn_mesh(name, path, r0, r1=0.0, rings=True, seg=10):
    """A tapered tube along a list of points (base to tip), ridged rings like a ram's horn."""
    bm = bmesh.new()
    loops = []
    n = len(path)
    for i, p in enumerate(path):
        t = i / (n - 1)
        r = r0 + (r1 - r0) * t
        if rings and 0 < i < n - 1:
            r *= 1.0 + 0.09 * math.sin(i * 2.1)
        d = (path[min(i + 1, n - 1)] - path[max(i - 1, 0)]).normalized()
        a = d.orthogonal().normalized()
        b = d.cross(a)
        loop = [bm.verts.new(p + (a * math.cos(k / seg * 2 * math.pi) + b * math.sin(k / seg * 2 * math.pi)) * max(r, 0.0006)) for k in range(seg)]
        loops.append(loop)
    for i in range(n - 1):
        for k in range(seg):
            bm.faces.new((loops[i][k], loops[i][(k + 1) % seg], loops[i + 1][(k + 1) % seg], loops[i + 1][k]))
    bm.faces.new(list(reversed(loops[0])))
    tip = bm.verts.new(path[-1] + (path[-1] - path[-2]).normalized() * r0 * 0.15)
    for k in range(seg):
        bm.faces.new((loops[-1][k], loops[-1][(k + 1) % seg], tip))
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    return o


def curl_path(base, out, up, length, curl, n=16):
    """A curling horn: out from the skull, sweeping back and round."""
    pts = []
    d = out.normalized()
    for i in range(n):
        t = i / (n - 1)
        ang = curl * t
        # rotate the direction about the axis (out x up) as it grows
        axis = d.cross(up).normalized()
        q = Quaternion(axis, -ang)
        dd = q @ d
        if i == 0:
            p = base.copy()
        else:
            p = pts[-1] + dd * (length / (n - 1))
        pts.append(p)
    return pts


def add_details(P, crown):
    parts = []
    hv = V.get('horns')
    up = Vector((0, 0, 1))
    if hv:
        for sx in (-1, 1):
            base = crown + Vector((0.06 * sx, -0.03, 0.06)) * V['skull']
            if hv['kind'] == 'bull':
                L = hv['length']
                p0, p1, p2 = base, base + Vector((0.6 * sx, 0.1, 0.05)) * L, base + Vector((0.55 * sx, -0.35, 0.85)) * L
                path = [(1 - t) ** 2 * p0 + 2 * (1 - t) * t * p1 + t * t * p2 for t in (i / 15 for i in range(16))]
            elif hv['kind'] == 'swept':
                # back along the skull and down, like a ridge of bone growing out of the temples
                L = hv['length']
                b2 = base + Vector((0.01 * sx, 0.02, -0.02))
                p0, p1, p2 = b2, b2 + Vector((0.25 * sx, 0.55, 0.35)) * L, b2 + Vector((0.3 * sx, 1.0, -0.05)) * L
                path = [(1 - t) ** 2 * p0 + 2 * (1 - t) * t * p1 + t * t * p2 for t in (i / 15 for i in range(16))]
            elif hv['kind'] == 'nubs':
                path = [base, base + Vector((0.2 * sx, 0.2, 1.0)) * hv['length'] * 0.5, base + Vector((0.3 * sx, 0.45, 1.0)) * hv['length']]
            elif hv['kind'] == 'crown':
                path = None
            elif hv['kind'] == 'ram':
                path = curl_path(base, Vector((0.9 * sx, 0.25, 0.55)), Vector((0.15 * sx, 0.9, 0.2)), hv['length'], 3.4)
            else:
                path = curl_path(base, Vector((0.35 * sx, 0.3, 0.9)), Vector((0, 1, 0)), hv['length'], 0.9)
            if path:
                parts.append(('Bip01 Head', horn_mesh('horn', path, hv['radius'], hv['radius'] * 0.08)))
        if hv['kind'] == 'crown':
            # a crown of horns ringing the skull, the tallest at the front
            for k in range(9):
                ang = (k / 9) * 2 * math.pi
                d = Vector((math.sin(ang), -math.cos(ang), 0))
                base = crown + (d * Vector((0.07, 0.085, 0)) + Vector((0, 0, 0.065))) * V['skull']
                L = hv['length'] * (1.0 + 0.6 * max(0, -d.y))
                tip = base + (d * 0.45 + Vector((0, 0, 1))).normalized() * L
                mid = base.lerp(tip, 0.5) + d * 0.04
                path = [(1 - t) ** 2 * base + 2 * (1 - t) * t * mid + t * t * tip for t in (i / 9 for i in range(10))]
                parts.append(('Bip01 Head', horn_mesh('horn', path, hv['radius'] * (1.2 if d.y < -0.5 else 0.9), 0.002)))
    tv = V.get('tusks')
    if tv:
        for sx in (-1, 1):
            base = crown + Vector((0.045 * sx, -0.1, -0.12)) * V['skull']
            path = curl_path(base, Vector((0.25 * sx, -0.55, 0.8)), Vector((0, 1, 0)), tv['length'], 0.9, n=8)
            parts.append(('Bip01 Head', horn_mesh('tusk', path, tv['radius'], 0.002, rings=False)))
        # fangs in the gash
        for sx in (-1, 1):
            base = crown + Vector((0.022 * sx, -0.118, -0.1)) * V['skull']
            parts.append(('Bip01 Head', horn_mesh('fang', [base, base + Vector((0, -0.003, -0.012)), base + Vector((0, -0.004, -0.026))], 0.006, 0.001, rings=False, seg=6)))
    sp = V.get('spikes')
    if sp:
        # a ridge of spines down the back, longest between the shoulders
        chain = [P['Spine'], P['Spine1'], P['Spine2'], P['Neck']]
        for k in range(sp['n']):
            t = k / max(1, sp['n'] - 1)
            seg = min(2, int(t * 3))
            u = t * 3 - seg
            base = chain[seg].lerp(chain[seg + 1], u) + Vector((0, 0.1 * V['m']['lat'] ** 0.4 + 0.02, 0))
            L = sp['length'] * (0.6 + 0.8 * math.sin(math.pi * min(1, t * 1.1)))
            bone = ['Bip01 Spine', 'Bip01 Spine1', 'Bip01 Spine2'][seg]
            parts.append((bone, horn_mesh('spike', [base - Vector((0, 0.02, 0)), base + Vector((0, 0.6, 0.55)).normalized() * L * 0.5, base + Vector((0, 0.75, 0.75)).normalized() * L], 0.014, 0.001, rings=False, seg=6)))
    if V.get('claws'):
        for s in ('L', 'R') + (('L2', 'R2') if V.get('arms2') else ()):
            for i in range(5):
                b, cc = P[f'{s}Finger{i}1'], P[f'{s}Finger{i}2']
                tip = cc + (cc - b) * 1.15
                d = (cc - b).normalized()
                path = [tip - d * 0.01, tip + d * V['claws'] * 0.5 + Vector((0, 0, -0.01)), tip + d * V['claws'] + Vector((0, 0, -0.03))]
                parts.append((f'Bip01 {s} Finger{i}2', horn_mesh('claw', path, 0.008, 0.0008, rings=False, seg=6)))
    if V.get('toeclaws'):
        for s in ('L', 'R'):
            an, toe = P[s + 'Foot'], P[s + 'Toe0']
            heel = an + Vector((0, 0.03, -0.07))
            ball = toe + Vector((0, 0, -0.01))
            fdir = (ball - heel).normalized()
            side = fdir.cross(up).normalized()
            for k in (-1, 0, 1):
                b0 = ball + side * 0.025 * k + fdir * 0.06 + side * 0.012 * k + Vector((0, 0, -0.012))
                path = [b0 - fdir * 0.005, b0 + fdir * V['toeclaws'] * 0.6, b0 + fdir * V['toeclaws'] + Vector((0, 0, -0.02))]
                parts.append((f'Bip01 {s} Toe0', horn_mesh('toeclaw', path, 0.01, 0.001, rings=False, seg=6)))
    return parts


# ---------------------------------------------------------------- armour and cloth
def _obj(name, bm):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    return o


def shell(name, centre, radii, M, keep, thick=0.012):
    """A plate: part of an ellipsoid's surface (keep(x, y, z) on the unit sphere), thickened."""
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=28, v_segments=18, radius=1.0)
    for v in list(bm.verts):
        if not keep(*v.co):
            bm.verts.remove(v)
    for v in bm.verts:
        v.co = centre + M @ Vector((v.co.x * radii[0], v.co.y * radii[1], v.co.z * radii[2]))
    o = _obj(name, bm)
    modifier_apply(o, 'SOLIDIFY', thickness=thick, offset=1.0)
    modifier_apply(o, 'BEVEL', width=0.003, segments=1)
    return o


def band(name, p, q, r0, r1, t0=0.0, t1=1.0):
    """A cylinder round the segment p..q from t0 to t1 (bracers, greaves)."""
    a, b = p.lerp(q, t0), p.lerp(q, t1)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=False, segments=16, radius1=r0, radius2=r1, depth=(b - a).length)
    M = (b - a).to_track_quat('Z', 'Y').to_matrix().to_4x4()
    M.translation = (a + b) / 2
    bmesh.ops.transform(bm, matrix=M, verts=bm.verts)
    o = _obj(name, bm)
    modifier_apply(o, 'SOLIDIFY', thickness=0.01, offset=1.0)
    return o


def ring(name, centre, rx, ry, r):
    bm = bmesh.new()
    n, m = 32, 8
    rings = []
    for i in range(n):
        a = i / n * 2 * math.pi
        c = centre + Vector((rx * math.cos(a), ry * math.sin(a), 0))
        out = Vector((math.cos(a), math.sin(a), 0))
        rings.append([bm.verts.new(c + (out * math.cos(j / m * 2 * math.pi) + Vector((0, 0, math.sin(j / m * 2 * math.pi)))) * r) for j in range(m)])
    for i in range(n):
        for j in range(m):
            bm.faces.new((rings[i][j], rings[(i + 1) % n][j], rings[(i + 1) % n][(j + 1) % m], rings[i][(j + 1) % m]))
    return _obj(name, bm)


def panel(name, top, width, length, out, curve=0.03):
    """A hanging cloth panel (a loincloth's front or back), weighted later from the skin."""
    bm = bmesh.new()
    nx, ny = 6, 10
    vs = []
    for j in range(ny + 1):
        row = []
        for i in range(nx + 1):
            u = i / nx - 0.5
            t = j / ny
            w = width * (1 - 0.25 * t)
            ragged = -0.03 * (abs(math.sin(i * 2.7)) if j == ny else 0)
            p = top + Vector((u * w, 0, -t * length + ragged)) + out * (curve * (1 - (2 * u) ** 2) + 0.02 * t)
            row.append(bm.verts.new(p))
        vs.append(row)
    for j in range(ny):
        for i in range(nx):
            bm.faces.new((vs[j][i], vs[j][i + 1], vs[j + 1][i + 1], vs[j + 1][i]))
    o = _obj(name, bm)
    modifier_apply(o, 'SOLIDIFY', thickness=0.006, offset=0.0)
    return o


def dress(P, crown):
    """Armour (bronze, each piece riding its bone) and cloth (weighted like the skin under it)."""
    out = []
    m = V['m']
    A = V.get('armour')
    pel, sp, sp1, sp2 = P['Pelvis'], P['Spine'], P['Spine1'], P['Spine2']
    if A:
        # a belt at the waist
        out.append(('armor', 'Bip01 Pelvis', ring('belt', sp.lerp(pel, 0.45) + Vector((0, 0.01, 0)), 0.165 * m['belly'] ** 0.6, 0.125 * m['belly'] ** 0.6, 0.022)))
        for s in ('L', 'R') + (('L2', 'R2') if V.get('arms2') else ()):
            el, wr = P[s + 'Forearm'], P[s + 'Hand']
            out.append(('armor', f'Bip01 {s[0]}{s[1:]} Forearm'.replace('  ', ' '), band('bracer', el, wr, 0.05 * m['fore'] ** 0.6, 0.042 * m['fore'] ** 0.5, 0.35, 0.92)))
    if A is True:
        X = Matrix.Identity(3)
        chestC = sp2.lerp(sp1, 0.35) + FWD * 0.02
        # the breastplate: the front of the ribcage, a little proud of it
        out.append(('armor', 'Bip01 Spine2', shell('breast', chestC + Vector((0, 0.02, 0.01)), (0.185 * m['chest'] ** 0.7, 0.14 * m['chest'] ** 0.6, 0.2), X, lambda x, y, z: y < -0.05 and -0.7 < z < 0.75, 0.014)))
        for sx, s in ((1, 'L'), (-1, 'R')):
            sh = P[s + 'UpperArm']
            Mrot = Matrix.Rotation(-0.45 * sx, 3, 'Y')
            out.append(('armor', f'Bip01 {s} Clavicle', shell('pauldron', sh + Vector((0.02 * sx, 0, 0.035)), (0.1 * m['delt'] ** 0.6, 0.095 * m['delt'] ** 0.6, 0.08), Mrot, lambda x, y, z: z > -0.15)))
            out.append(('armor', f'Bip01 {s} Clavicle', shell('pauldron2', sh + Vector((0.035 * sx, 0, -0.01)), (0.095 * m['delt'] ** 0.6, 0.09 * m['delt'] ** 0.6, 0.07), Mrot, lambda x, y, z: -0.1 < z < 0.6)))
            kn, an = P[s + 'Calf'], P[s + 'Foot']
            out.append(('armor', f'Bip01 {s} Calf', band('greave', kn, an, 0.05 * m['calf'] ** 0.6, 0.04, 0.12, 0.85)))
        # the helm: over the cranium, down to the brow, a ridge along the top
        out.append(('armor', 'Bip01 Head', shell('helm', crown + Vector((0, 0.012, 0.005)), (0.098 * V['skull'], 0.118 * V['skull'], 0.11 * V['skull']), X, lambda x, y, z: z > -0.12 and not (y < -0.5 and z < 0.3), 0.012)))
        for sx in (-1, 1):
            base = crown + Vector((0.075 * sx, -0.02, 0.06)) * V['skull']
            L = 0.3
            p0, p1, p2 = base, base + Vector((0.5 * sx, 0.05, 0.25)) * L, base + Vector((0.6 * sx, -0.25, 0.85)) * L
            out.append(('horn', 'Bip01 Head', horn_mesh('helmhorn', [(1 - t) ** 2 * p0 + 2 * (1 - t) * t * p1 + t * t * p2 for t in (i / 11 for i in range(12))], 0.03, 0.002)))
    if V.get('cloth') == 'loin':
        top = sp.lerp(pel, 0.65)
        r = 0.15 * m['belly'] ** 0.6
        out.append(('cloth', None, panel('loinF', top + Vector((0, -r * 0.85, 0)), 0.24 * m['belly'] ** 0.5, 0.42, Vector((0, -1, 0)))))
        out.append(('cloth', None, panel('loinB', top + Vector((0, r * 0.8, 0)), 0.26 * m['belly'] ** 0.5, 0.36, Vector((0, 1, 0)))))
        if not A:
            out.append(('armor', 'Bip01 Pelvis', ring('belt', top + Vector((0, 0.01, 0.02)), 0.16 * m['belly'] ** 0.6, 0.125 * m['belly'] ** 0.6, 0.02)))
    if NAME == 'rakshasa':
        # a necklace of skulls: bone beads round the base of the neck
        nk = P['Neck']
        for k in range(13):
            a = math.pi * (0.1 + 0.8 * k / 12)
            c = nk + Vector((0.13 * math.cos(a) * m['traps'] ** 0.3, -0.12 * math.sin(a), -0.07 - 0.05 * math.sin(a)))
            bm = bmesh.new()
            bmesh.ops.create_uvsphere(bm, u_segments=8, v_segments=6, radius=0.022)
            bmesh.ops.translate(bm, vec=c, verts=bm.verts)
            out.append(('horn', 'Bip01 Spine2', _obj('skull', bm)))
    return out


# ---------------------------------------------------------------- previews
def preview(objs, prefix):
    sc = bpy.context.scene
    lo = Vector((1e9,) * 3)
    hi = Vector((-1e9,) * 3)
    for o in objs:
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            lo = Vector(map(min, lo, w))
            hi = Vector(map(max, hi, w))
    ctr = (lo + hi) / 2
    h = hi.z - lo.z
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    sc.collection.objects.link(cam)
    sc.camera = cam
    sc.render.engine = 'BLENDER_WORKBENCH'
    sc.display.shading.light = 'STUDIO'
    sc.display.shading.color_type = 'SINGLE'
    sc.display.shading.single_color = (0.55, 0.52, 0.5)
    sc.display.shading.show_cavity = True
    sc.display.shading.cavity_type = 'BOTH'
    sc.render.resolution_x = 600
    sc.render.resolution_y = 800
    for name, ang, zf in [('front', 0, 0.05), ('side', 90, 0.05), ('q', 35, 0.05), ('face', 25, 0.0)]:
        r = h * (1.7 if name != 'face' else 0.42)
        t = math.radians(ang)
        tgt = ctr if name != 'face' else Vector((ctr.x, ctr.y, hi.z - 0.22 * h))
        cam.location = (tgt.x + r * math.sin(t), tgt.y - r * math.cos(t), tgt.z + h * zf)
        cam.rotation_euler = (tgt - cam.location).to_track_quat('-Z', 'Y').to_euler()
        sc.render.filepath = f'{prefix}-{name}.png'
        bpy.ops.render.render(write_still=True)


# ---------------------------------------------------------------- the game mesh
def select_only(objs, active=None):
    for o in bpy.context.selected_objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = active or objs[0]


def modifier_apply(o, kind, **kw):
    select_only([o])
    m = o.modifiers.new(kind.lower(), kind)
    for k, v in kw.items():
        setattr(m, k, v)
    bpy.ops.object.modifier_apply(modifier=m.name)
    return o


def detail(high):
    """Skin worth looking at closely: lumps and knots, and fine cracks like dried earth."""
    d = V.get('displace', {})
    t1 = bpy.data.textures.new('lumps', 'CLOUDS')
    t1.noise_scale = 0.045
    t1.noise_depth = 3
    modifier_apply(high, 'DISPLACE', texture=t1, strength=d.get('cloud', 0.005), mid_level=0.5, texture_coords='GLOBAL')
    t2 = bpy.data.textures.new('cracks', 'VORONOI')
    t2.noise_scale = 0.018
    t2.distance_metric = 'DISTANCE'
    t2.color_mode = 'INTENSITY'
    modifier_apply(high, 'DISPLACE', texture=t2, strength=d.get('crack', 0.004), mid_level=0.15, texture_coords='GLOBAL')


def game_mesh(base, faces):
    low = base.copy()
    low.data = base.data.copy()
    low.name = 'skin'
    bpy.context.scene.collection.objects.link(low)
    modifier_apply(low, 'REMESH', mode='VOXEL', voxel_size=0.011)
    n = len(low.data.polygons)
    if n > faces:
        modifier_apply(low, 'DECIMATE', ratio=faces / n)
    select_only([low])
    bpy.ops.object.shade_smooth()
    return low


def bake(low, high, size):
    """Normal and cavity from the detailed sculpt onto the game mesh."""
    select_only([low])
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.004)
    bpy.ops.object.mode_set(mode='OBJECT')
    mat = bpy.data.materials.new('skin')
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes['Principled BSDF']
    low.data.materials.clear()
    low.data.materials.append(mat)
    imgs = {}
    for kind, res in (('normal', size), ('ao', size // 2)):
        img = bpy.data.images.new(f'{NAME}_{kind}', res, res, alpha=False, float_buffer=False)
        img.colorspace_settings.name = 'Non-Color' if kind == 'normal' else 'sRGB'
        node = nt.nodes.new('ShaderNodeTexImage')
        node.image = img
        imgs[kind] = (img, node)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = 16
    for kind, btype in (('normal', 'NORMAL'), ('ao', 'AO')):
        img, node = imgs[kind]
        nt.nodes.active = node
        select_only([high, low], active=low)
        bpy.ops.object.bake(type=btype, use_selected_to_active=True, cage_extrusion=0.02, max_ray_distance=0.06, margin=6)
        path = os.path.join('/tmp', f'{NAME}_{kind}.png')
        img.filepath_raw = path
        img.file_format = 'PNG'
        img.save()
    # wire them: the cavity as the base colour (the game reads its brightness), the normal map
    nm = nt.nodes.new('ShaderNodeNormalMap')
    nt.links.new(imgs['normal'][1].outputs['Color'], nm.inputs['Color'])
    nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    nt.links.new(imgs['ao'][1].outputs['Color'], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = 0.55


MATS = {'horn': ((0.32, 0.27, 0.2), 0.4, 0.0), 'armor': ((0.55, 0.36, 0.16), 0.32, 0.9), 'cloth': ((0.28, 0.06, 0.04), 0.85, 0.0)}


def join_parts(items):
    """One mesh per material (horn, armour, cloth), each piece's vertex group naming its bone."""
    groups = {}
    for mat, bone, o in items:
        if bone:
            g = o.vertex_groups.new(name=bone)
            g.add(list(range(len(o.data.vertices))), 1.0, 'REPLACE')
        groups.setdefault(mat, []).append(o)
    out = []
    for mat, objs in groups.items():
        select_only(objs)
        if len(objs) > 1:
            bpy.ops.object.join()
        o = bpy.context.view_layer.objects.active
        o.name = mat
        bpy.ops.object.shade_smooth()
        mm = bpy.data.materials.new(mat)
        mm.use_nodes = True
        bsdf = mm.node_tree.nodes['Principled BSDF']
        col, rough, metal = MATS[mat]
        bsdf.inputs['Base Color'].default_value = (*col, 1)
        bsdf.inputs['Roughness'].default_value = rough
        bsdf.inputs['Metallic'].default_value = metal
        o.data.materials.clear()
        o.data.materials.append(mm)
        out.append(o)
    return out


def copy_weights(cloth, skin):
    """Cloth moves as the skin nearest it does (its four strongest bones)."""
    from mathutils.kdtree import KDTree
    kd = KDTree(len(skin.data.vertices))
    for v in skin.data.vertices:
        kd.insert(skin.matrix_world @ v.co, v.index)
    kd.balance()
    names = {g.index: g.name for g in skin.vertex_groups}
    for v in cloth.data.vertices:
        _, idx, _ = kd.find(cloth.matrix_world @ v.co)
        ws = sorted(((g.weight, names[g.group]) for g in skin.data.vertices[idx].groups), reverse=True)[:4]
        tot = sum(w for w, _ in ws) or 1
        for w, n in ws:
            g = cloth.vertex_groups.get(n) or cloth.vertex_groups.new(name=n)
            g.add([v.index], w / tot, 'REPLACE')


def rig(arm, skin, extras, crown):
    select_only([skin, arm], active=arm)
    bpy.ops.object.parent_set(type='ARMATURE_AUTO')
    for o in extras:
        if o.name.startswith('cloth'):
            copy_weights(o, skin)
        select_only([o, arm], active=arm)
        bpy.ops.object.parent_set(type='ARMATURE_NAME')  # (keeps the groups made above)
    # the eyes: two points in the sockets, children of the head bone (the game lights them)
    if not V.get('blind'):
        for sx, nm in ((1, 'eye_L'), (-1, 'eye_R')):
            e = bpy.data.objects.new(nm, None)
            bpy.context.scene.collection.objects.link(e)
            e.parent = arm
            e.parent_type = 'BONE'
            e.parent_bone = 'Bip01 Head'
            e.matrix_world = Matrix.Translation(crown + Vector((0.034 * sx, -0.105, -0.03)) * V['skull'])


def export(arm, objs):
    select_only([arm] + objs + [o for o in bpy.context.scene.objects if o.type == 'EMPTY'], active=arm)
    bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_animations=False, export_skins=True, export_apply=False, export_image_format='WEBP', export_yup=True)


# ---------------------------------------------------------------- main
arm = load_rig()
edit_proportions(arm)
P = joints(arm)
res = 0.012 if FAST else 0.006
S = sculpt_body(P, res)
crown = sculpt_head(S, P)
body = S.mesh()
body.name = 'body'
parts = [('horn', bone, o) for bone, o in add_details(P, crown)] + dress(P, crown)
if PREVIEW:
    preview([body] + [o for _, _, o in parts], PREVIEW)
if OUT != '-':
    skin = game_mesh(body, V.get('faces', 16000))
    if not FAST:
        detail(body)
        bake(skin, body, 2048)
    bpy.data.objects.remove(body, do_unlink=True)
    extras = join_parts(parts)
    rig(arm, skin, extras, crown)
    export(arm, [skin] + extras)
    print('VILLAIN', NAME, 'faces', len(skin.data.polygons), '+', sum(len(o.data.polygons) for o in extras), '->', OUT)
