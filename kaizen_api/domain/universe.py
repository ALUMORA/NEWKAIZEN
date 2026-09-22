"""Universos y listas de candidatos: Fórmula Mágica, FIBRAs y ETF sectoriales.

Movido sin cambios desde backend.py (fase S1): los cuerpos son idénticos al legado y los
goldens de tests/goldens_legacy lo prueban. La versión v2 se escribe al lado, no encima.
"""


SECTOR_ETF = {
    "Technology": "XLK", "Healthcare": "XLV", "Financial Services": "XLF",
    "Financials": "XLF", "Energy": "XLE", "Consumer Cyclical": "XLY",
    "Consumer Defensive": "XLP", "Industrials": "XLI", "Materials": "XLB",
    "Real Estate": "XLRE", "Utilities": "XLU", "Communication Services": "XLC",
    "Basic Materials": "XLB",
}


MAGIC_UNIVERSE = [
    # Technology
    "AAPL","MSFT","NVDA","GOOGL","META","AVGO","ORCL","ADBE","CRM","AMD",
    "INTC","QCOM","TXN","NOW","NFLX","IBM","ACN","CTSH","FTNT","CDNS",
    # Healthcare
    "LLY","UNH","JNJ","ABBV","MRK","TMO","ABT","BMY","AMGN","GILD",
    "VRTX","ISRG","MCK","CVS","CI",
    # Consumer Cyclical
    "AMZN","TSLA","HD","MCD","SBUX","NKE","BKNG","TJX","ROST","CMG",
    "LOW","F","GM","ORLY","AZO",
    # Consumer Defensive
    "WMT","COST","PG","KO","PEP","PM","TGT","MO","CL","MDLZ",
    # Industrials
    "CAT","DE","HON","RTX","GE","BA","FDX","UPS","UNP","LMT",
    # Energy
    "XOM","CVX","COP","SLB","OXY","MPC","EOG",
    # Materials
    "LIN","APD","NEM","FCX","SHW",
    # Communication Services
    "DIS","CMCSA","EA","FOXA",
]


EXCLUDED_SECTORS = {
    "Financial Services", "Financials", "Utilities",
    "Real Estate",  # REITs tienen estructura diferente
}


FIBRAS_LIST = [
    # FIBRAMQ y Storage cambiaron de símbolo; Terrafina (TERRA13) la absorbió Fibra Prologis
    # y LFPE ya no cotiza en Yahoo, así que se sustituyen por FNOVA y FSHOP.
    "FUNO11.MX", "FIBRAMQ12.MX", "FIBRAPL14.MX", "FNOVA17.MX",
    "FINN13.MX",  "DANHOS13.MX", "FMTY14.MX",    "FHIPO14.MX",
    "STORAGE18.MX", "FSHOP13.MX",
]
