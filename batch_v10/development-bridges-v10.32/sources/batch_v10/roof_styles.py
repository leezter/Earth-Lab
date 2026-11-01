"""Deterministic inferred roof finishes, subordinate to mapped attributes."""
import hashlib,random,re
PALETTE={'red':'#a44935','brown':'#765344','grey':'#777d80','gray':'#777d80','darkgrey':'#454c50','darkgray':'#454c50','black':'#303438','white':'#d9d6cd','green':'#557364','blue':'#526d83','orange':'#b66d43','yellow':'#b9a46f','beige':'#b4a18a','silver':'#a3a9aa','copper':'#9c6850','terracotta':'#ad6143'}
def colour(value):
 text=str(value or '').strip().lower().replace(' ','').replace('_','')
 text=PALETTE.get(text,text)
 if re.fullmatch(r'#[0-9a-f]{3}',text):text='#'+''.join(c*2 for c in text[1:])
 if not re.fullmatch(r'#[0-9a-f]{6}',text):return None
 return tuple(int(text[i:i+2],16)/255 for i in [1,3,5])
def style(b,context):
 rng=random.Random(int(hashlib.sha256(('roof-v3:'+str(b['id'])).encode()).hexdigest()[:16],16))
 tag=str(b.get('material')or '').lower();mapped=True
 if any(k in tag for k in ['metal','zinc','copper','steel','aluminium','aluminum','tin']):asset='corrugated_iron'
 elif any(k in tag for k in ['tile','ceramic','clay']):asset='clay_roof_tiles_02'
 elif 'slate'in tag:asset='roof_slates_02'
 elif any(k in tag for k in ['asphalt','bitumen','tar','concrete','gravel','membrane']):asset='asphalt_02'
 else:
  mapped=False
  if b.get('roof')=='flat':asset='asphalt_02'
  elif b.get('industrial_inferred'):asset='corrugated_iron'
  else:
   weights={'british':[80,18,2],'mediterranean':[10,85,5]}.get(context.get('regional_guess'),[55,35,10])
   asset=rng.choices(['roof_slates_02','clay_roof_tiles_02','corrugated_iron'],weights)[0]
 c=colour(b.get('color'));mapped_colour=c is not None
 if c is None:
  tones={'roof_slates_02':['#606b76','#757976','#4c535c','#857c71'],'clay_roof_tiles_02':['#a9573c','#b06b4a','#8d4938','#a87559'],'corrugated_iron':['#84908e','#687576','#95877a'],'asphalt_02':['#515557','#666761','#77736a']}
  c=colour(rng.choice(tones[asset]))
 return {'asset':asset,'colour':c,'mapped_material':mapped,'mapped_colour':mapped_colour,'unsupported_material':tag if tag and not mapped else None,'weather':round(rng.uniform(.05,.18),3),'brightness':1 if mapped_colour else round(rng.uniform(.88,1.08),3)}
