import urllib.request
import json
req = urllib.request.Request('https://www.isyatirim.com.tr/tr-tr/analiz/_Layouts/15/IsYatirim.Website/StockInfo/CompanyInfoAjax.aspx/getScreenerDataNEW', 
data=json.dumps({"sektor": "", "endeks": "", "takip": "", "oneri": "", "criterias": [], "lang": "1055"}).encode('utf-8'),
headers={'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0'})
try:
    res = urllib.request.urlopen(req)
    data = json.loads(res.read())
    d_str = data.get('d', '[]')
    arr = json.loads(d_str)
    if len(arr) > 0:
        print(list(arr[0].keys()))
except Exception as e:
    pass
