"""Choose the current build without hiding the last playable renderer version."""
def displayed(entries, identifier, modified):
    groups={}
    for entry in entries:
        groups.setdefault((round(entry['lat'],6),round(entry['lon'],6)),[]).append(entry)
    result=[]
    for (lat,lon),group in groups.items():
        current=next((e for e in group if e['id']==identifier(lat,lon)),None)
        ready=[e for e in group if e['status']=='built']
        if current and current['status']=='built':result.append(current)
        elif ready:result.append(max(ready,key=modified))
        elif current:result.append(current)
    return result
