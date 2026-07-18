VMMS 3.2 – SCHONE HERINSTALLATIE
=================================

Versie: 3.2.0-clean-20260717

Dit pakket bevat alleen de bestanden die GitHub Pages nodig heeft.
Oude README-bestanden, ZIP-bestanden en startscripts zijn verwijderd.

BELANGRIJK
----------
Upload niet het ZIP-bestand zelf. Pak het eerst uit en upload daarna
alle losse bestanden uit de uitgepakte map.

GitHub-repository volledig leegmaken
------------------------------------
Makkelijkste methode op een computer:
1. Open https://github.dev/variatie/VMMS-variatie
2. Open links de Verkenner.
3. Selecteer alle bestaande bestanden.
4. Kies Delete.
5. Open links Source Control.
6. Vul als bericht in: Schone herinstallatie VMMS
7. Kies Commit & Push.

Daarna opnieuw uploaden:
1. Open https://github.com/variatie/VMMS-variatie
2. Kies Add file > Upload files.
3. Upload ALLE losse bestanden uit dit pakket, inclusief .nojekyll.
4. Kies Commit changes.
5. Wacht twee minuten.
6. Open https://variatie.github.io/VMMS-variatie/
7. Sluit een eventueel geïnstalleerde VMMS-app eerst volledig af.

Controle:
Ga in VMMS naar Instellingen > Over deze app.
Daar moet versie 3.2.0-clean-20260717 staan.

Cacheverbetering:
- HTML, JavaScript, CSS en data worden voortaan eerst online gecontroleerd.
- Bestandsnamen krijgen een versienummer.
- Oude service-worker-caches worden automatisch verwijderd.
- Afbeeldingen blijven offline beschikbaar.

Je Google Drive-database wordt niet verwijderd door het leegmaken van GitHub.
Na het opnieuw verbinden worden je bestaande gegevens weer geladen.
