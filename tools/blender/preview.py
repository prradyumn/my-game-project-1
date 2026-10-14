# Render front / side / three-quarter previews of a model (workbench, matcap-like grey).
#   blender -b -P tools/blender/preview.py -- <in.fbx|.glb|.blend> <out_prefix>
import bpy, sys, math
from mathutils import Vector
a = sys.argv[sys.argv.index('--') + 1:]
src, out = a[0], a[1]
if src.endswith('.blend'):
    bpy.ops.wm.open_mainfile(filepath=src)
else:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    if src.endswith('.fbx'):
        bpy.ops.import_scene.fbx(filepath=src)
    else:
        bpy.ops.import_scene.gltf(filepath=src)
sc = bpy.context.scene
meshes = [o for o in sc.objects if o.type == 'MESH' and o.visible_get()]
lo = Vector((1e9,) * 3); hi = Vector((-1e9,) * 3)
dg = bpy.context.evaluated_depsgraph_get()
for o in meshes:
    for c in o.bound_box:
        w = o.matrix_world @ Vector(c)
        lo = Vector(map(min, lo, w)); hi = Vector(map(max, hi, w))
ctr = (lo + hi) / 2; h = hi.z - lo.z
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam
cam.data.lens = 50
sc.render.engine = 'BLENDER_WORKBENCH'
sc.display.shading.light = 'STUDIO'; sc.display.shading.color_type = 'MATERIAL' if '--tex' in a else 'SINGLE'
sc.display.shading.single_color = (0.62, 0.6, 0.58)
sc.display.shading.show_cavity = True; sc.display.shading.cavity_type = 'BOTH'
sc.render.resolution_x = 700; sc.render.resolution_y = 900
for name, ang in [('front', 0), ('side', 90), ('q', 35)]:
    r = h * 1.75
    t = math.radians(ang)
    cam.location = (ctr.x + r * math.sin(t), ctr.y - r * math.cos(t), ctr.z + h * 0.05)
    d = ctr - cam.location
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    sc.render.filepath = f'{out}-{name}.png'
    bpy.ops.render.render(write_still=True)
