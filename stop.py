from pathlib import Path
import urllib.request
try:
 token=Path(__file__).with_name('server-token.txt').read_text()
 r=urllib.request.Request('http://127.0.0.1:47841/api/stop',data=b'',headers={'X-Stop-Token':token},method='POST')
 with urllib.request.urlopen(r,timeout=5)as response:print(response.read().decode())
except Exception as e:print('Rendered prototype already stopped or unavailable:',e)
