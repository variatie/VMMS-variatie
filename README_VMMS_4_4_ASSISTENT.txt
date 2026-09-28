VMMS 4.4 Assistent
Versie: 4.4.0-assistent-20260928

Wat is nieuw
- Bronnen in antwoorden tonen type, titel, VMMS-ID en beschikbare datum.
- Met Open bron ga je naar de bijbehorende VMMS-sectie; waar mogelijk wordt de registratie gemarkeerd.
- Tekst uit een zelf gekozen .txt- of .md-bestand, of geplakte tekst, kan worden doorzocht.
- Drie eenvoudige visuele conceptschema's: 24/230 V, Sola 15/Mar-IX en drink-/vuilwater.
- Vanuit een passende bron kan een concept-werkbon worden ingevuld. Opslaan gebeurt pas nadat je zelf controleert en op Werkbon verwerken drukt.
- Korte vervolgvragen zoals "En de pomp?" nemen het vorige onderwerp mee.
- Het tijdelijke assistentgesprek en de inhoud van het assistentscherm verdwijnen bij vergrendelen.

Google Drive
De bestaande Drive-koppeling leest en synchroniseert uitsluitend het verborgen VMMS-gegevensbestand in de Drive-appmap. Deze versie zoekt niet rechtstreeks in willekeurige documenten in Mijn Drive. Exporteer een gewenst document als platte tekst en voeg die tekst in de assistent toe. Na de gewone VMMS-sync zit die tekst in de VMMS-database op je andere apparaten. Voeg geen vertrouwelijke documenttekst toe zolang de browseropslag niet apart is beveiligd.

Privacy en veiligheid
De website blijft een openbare statische GitHub Pages-site. De pincode is een schermslot, geen echte toegangsbeveiliging van broncode of lokaal opgeslagen browsergegevens. Zet geen geheimen in de openbare bronbestanden. De assistent stuurt vragen en antwoorden niet naar een externe AI-dienst. De schema's zijn concepten; controleer de werkelijke installatie en fabrikantdocumentatie voor werk aan stroom, verwarming, koeling of water.

Upgrade
De bestaande VMMS-database, Google Drive-sync, foto's en overige pagina's blijven ongewijzigd. Deze versie voegt assistant-diagrams.js toe en wijzigt de assistent, vormgeving, app-integratie en cacheversie. Een fotoarchief met ontbrekende Drive-bestanden wordt hiermee niet automatisch gerepareerd; gebruik daarvoor de bestaande Drive-indexherstel-functie.

Controle
Voer lokaal `node --test tests/assistant.test.mjs` uit. De tests controleren schemasoorten, documentzoeken, veilige weergave van documenttekst en vervolgvragen.
