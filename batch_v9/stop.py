from pathlib import Path
import urllib.request
try:
 request=urllib.request.Request('http://127.0.0.1:47851/api/stop',data=b'',headers={'X-Stop-Token':Path(__file__).with_name('server-token.txt').read_text()},method='POST')
 with urllib.request.urlopen(request,timeout=5)as r:print(r.read().decode())
except Exception as e:print('Batch viewer stopped or unavailable:',e)
