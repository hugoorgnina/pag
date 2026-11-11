import bpy, sys, os, mathutils
args=sys.argv[sys.argv.index('--')+1:]
src, outdir = args
texdir=os.path.join(outdir,'textures')
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=src)
# target triangle counts per mesh (Melee-friendly total ~6k)
target={'Bodysuit':1300,'Top':1200,'Hair':900,'Face':900,'Hair accessories':350,'Hair braid':300,'Shoes':350,'Sleeves':400}
# texture sizes (power of two)
texsize={'Face.png':256,'Eyes.png':128,'Hair.jpg':256,'Top.png':256,'Bodysuit.png':128,'shoes.png':128,'Hair accessories.png':256,'Badge.jpg':64}
meshes=[o for o in bpy.data.objects if o.type=='MESH']
for o in meshes:
    bpy.context.view_layer.objects.active=o
    # drop shape keys (Melee models do not use blend shapes); keep Basis
    if o.data.shape_keys:
        o.shape_key_clear()
    o.select_set(True); bpy.ops.object.transform_apply(location=True,rotation=True,scale=True); o.select_set(False)
    o.data.calc_loop_triangles(); n=len(o.data.loop_triangles)
    if o.name in target and n>target[o.name]:
        m=o.modifiers.new('dec','DECIMATE'); m.ratio=target[o.name]/n; m.use_collapse_triangulate=True
        bpy.ops.object.modifier_apply(modifier='dec')
# merge duplicate material that uses the same texture
ha=bpy.data.materials['CH_1910_01_body.002']
for o in meshes:
    for s in o.material_slots:
        if s.material and s.material.name=='Material.013': s.material=ha
# missing texture material -> plain colour
m4=bpy.data.materials['Material.004']
for n in list(m4.node_tree.nodes):
    if n.type=='TEX_IMAGE': m4.node_tree.nodes.remove(n)
m4.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value=(0.85,0.85,0.9,1)
# resize + relink textures
from PIL import Image
done={}
for mat in bpy.data.materials:
    if not mat.node_tree: continue
    for n in list(mat.node_tree.nodes):
        if n.type!='TEX_IMAGE' or not n.image: continue
        if not n.outputs[0].links: mat.node_tree.nodes.remove(n); continue
        base=os.path.basename(bpy.path.abspath(n.image.filepath))
        if base not in texsize: continue
        if base not in done:
            im=Image.open(bpy.path.abspath(n.image.filepath))
            has_a = im.mode in ('RGBA','LA') and im.getchannel('A').getextrema()[0]<255
            im=im.convert('RGBA' if has_a else 'RGB')
            s=texsize[base]; im=im.resize((s,s),Image.LANCZOS)
            name=os.path.splitext(base)[0].replace(' ','_').lower()+'.png'
            p=os.path.join(texdir,name); im.save(p); done[base]=p
        n.image=bpy.data.images.load(done[base],check_existing=True)
# put feet on the floor, centred
pts=[o.matrix_world@mathutils.Vector(c) for o in meshes for c in o.bound_box]
mnz=min(p.z for p in pts); cx=(min(p.x for p in pts)+max(p.x for p in pts))/2; cy=(min(p.y for p in pts)+max(p.y for p in pts))/2
for o in meshes:
    o.data.transform(mathutils.Matrix.Translation((-cx,-cy,-mnz)))
bpy.ops.outliner.orphans_purge(do_recursive=True)
tot=0
for o in meshes:
    o.data.calc_loop_triangles(); tot+=len(o.data.loop_triangles); print('MESH',o.name,len(o.data.vertices),'v',len(o.data.loop_triangles),'tris')
print('TOTAL tris',tot)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(outdir,'emilia_melee.blend'))
bpy.ops.export_scene.fbx(filepath=os.path.join(outdir,'emilia_melee.fbx'),path_mode='RELATIVE',embed_textures=False,apply_unit_scale=True,bake_space_transform=True,mesh_smooth_type='FACE',add_leaf_bones=False)
bpy.ops.wm.collada_export(filepath=os.path.join(outdir,'emilia_melee.dae')) if hasattr(bpy.ops.wm,'collada_export') else print('no collada')
