window.VMMS_ASSISTANT_KNOWLEDGE = [
  {
    id: 'HB-MOTOR-START', type: 'Handboek', title: 'Hoofdmotor starten en stoppen',
    status: 'Historisch - aan boord verifieren', tags: ['motor','daewoo','starten','stoppen','vetpot','wierpot'],
    text: 'Voor het starten: controleer motorolie, olie van de keerkoppeling, koelvloeistof, dieselniveau van de dagtank en beide wierpotten. Open het schoorsteenklepje en ventileer zo nodig via de koekoek. Stop de motor met de rode stopknop, wacht op het signaal en neem daarna pas de sleutel uit. Geef na het draaien de vetpot een slag tot weerstand wordt gevoeld en sluit het schoorsteenklepje.'
  },
  {
    id: 'HB-MOTOR-ONTLUCHTEN', type: 'Handboek', title: 'Hoofdmotor ontluchten',
    status: 'Veiligheidskritisch - vakman en actuele handleiding leidend', tags: ['motor','brandstof','ontluchten','nozzle','hogedruk'],
    text: 'Het oude handboek beschrijft doorpompen met het handpompje en het lossen van een leiding bij de injectoren. Daar kan gevaarlijk hoge brandstofdruk optreden. Gebruik deze historische beschrijving niet als zelfstandige werkinstructie; volg de actuele Daewoo-handleiding en laat dit bij twijfel door een vakman uitvoeren. Controleer na afloop op lekkage.'
  },
  {
    id: 'HB-DAGTANK', type: 'Handboek', title: 'Dagtank handmatig vullen',
    status: 'Historisch - werking en kranen verifieren', tags: ['diesel','dagtank','zwengelpomp','brandstof'],
    text: 'Als de zwengelpomp niet pakt, vermeldt het handboek dat kort laten draaien van de motor de leiding via de retour kan vullen. Sluit na het vullen de kraan op de pomp en controleer de aandraaimoer op lekkage. De schaalverdeling van de hoofdtank is slechts een schatting.'
  },
  {
    id: 'HB-GENERATOR', type: 'Handboek', title: 'Westerbeke generator bediening en onderhoud',
    status: 'Type en actuele handleiding controleren', tags: ['generator','westerbeke','olie','250 uur','startaccu','storing'],
    text: 'Stop met een korte stevige druk op de stopknop. Het handboek noemt olieverversing om de 250 draaiuren en waarschuwt dat de eigen startaccu niet automatisch door het boordnet werd onderhouden. Controleer eerst het exacte type, de huidige bedrading en de officiele Westerbeke-handleiding.'
  },
  {
    id: 'HB-GENERATOR-STORING', type: 'Storingskaart', title: 'Generator draait maar laadt niet',
    status: 'Historische noodnotitie - paneel en handleiding verifieren', tags: ['generator','laadt niet','frequency failure','under speed','ecu'],
    text: 'Volgens het oude handboek stonden bij eerdere storingen een zwarte buitenste schakelaar en een witte hendel bij de startbediening in de verkeerde stand. Zet niets om voordat functie en actuele markering zijn gecontroleerd. Noteer foutcode, spanning en omstandigheden en raadpleeg de Westerbeke-handleiding.'
  },
  {
    id: 'HB-BILGE', type: 'Handboek', title: 'Bilgepomp machinekamer',
    status: 'Verifiëren', tags: ['bilge','dompelpomp','machinekamer','milieu','olie','diesel'],
    text: 'De oude dompelpomp tussen generator en vetpot was bewust niet automatisch geschakeld om ongecontroleerde lozing van olie of diesel te voorkomen. Afvoerroute en stekkerlocatie waren onzeker. Controleer de actuele installatie, milieumaatregelen en alarmfunctie aan boord.'
  },
  {
    id: 'HB-SANI-KEUKEN', type: 'Handboek', title: 'Keukenafvoer en wasmachine',
    status: 'Onvolledige historische situatie', tags: ['keuken','sani','wasmachine','vaatwasser','afvoer','douche'],
    text: 'De Sani-leiding onder het keukenaanrecht was volgens het handboek niet aangesloten op de opvangtank achter het bad. Ook de wasmachineafvoer was niet definitief aangesloten en liep tijdelijk via het bad. Leg de actuele leidingloop, terugslagbeveiliging en capaciteit vast voordat wasmachine, vaatwasser of bijkeuken wordt aangesloten.'
  },
  {
    id: 'HB-SANI-TOILET', type: 'Handboek', title: 'Sanitoilet en afvoerleiding',
    status: 'Historisch - materiaal en route verifieren', tags: ['toilet','sani','vuilwater','slang','azijn','soda'],
    text: 'De toiletafvoer liep onder de vloer naar de badkamer. Het kleine pijpje op de Sani diende als overloopwaarschuwing. Het handboek noemt periodiek warm water met soda tegen vet en beperkt azijn tegen kalk; controleer eerst of dit bij de huidige pomp, slangen en fabrikantvoorschriften past.'
  },
  {
    id: 'HB-BAD-TANK', type: 'Storingskaart', title: 'Opvangtank achter het bad',
    status: 'Storing gemeld - hoge prioriteit', tags: ['bad','douche','opvangtank','vlotterschakelaar','hoogwater','24v','vuilwater'],
    text: 'In het oude handboek werkte het hoogwateralarm, maar waren de automatische vlotterschakelaars defect of onzeker. De tank moest daardoor handmatig worden geleegd, soms dagelijks. Bevestig de huidige werking met een gecontroleerde test en maak bij defect een werkbon; voorkom overvullen.'
  },
  {
    id: 'HB-VUILWATERPOMP', type: 'Handboek', title: 'Versnijdingspomp achter het bad',
    status: 'Historische werkinstructie - afsluiters verifieren', tags: ['rheinstrom','vuilwater','versnijdingspomp','bad','vooronder','24v'],
    text: 'De Rheinstrom-pomp voerde van de opvangtank achter het bad naar de vuilwatertank in het vooronder. Voor werkzaamheden: tank veilig legen, juiste 24 V-groep uitschakelen, vloeistof opvangen, afsluiters en bestemming controleren, met schoon water testen en op lekkage controleren. De oude labels konden verwarrend zijn.'
  },
  {
    id: 'HB-VORST', type: 'Checklist', title: 'Vorstmaatregelen',
    status: 'Aanpassen aan actuele installatie en brandveiligheid', tags: ['vorst','winter','pompen','machinekamer','vooronder','buitenboordmotor'],
    text: 'Bescherm water- en vuilwaterpompen, leidingen, vooronder en machinekamer tegen vorst. Controleer buitenboordmotor en afsluiters. Gebruik alleen veilige, daarvoor bedoelde verwarming en isolatie; de oude oplossingen met olielampen of gloeilampen gelden niet als hedendaags advies.'
  },
  {
    id: 'HB-STORM', type: 'Checklist', title: 'Stormronde aan dek',
    status: 'Praktische checklist', tags: ['storm','wind','dek','meertouwen','spudpaal','roer','luiken'],
    text: 'Controleer meertouwen en voeg zo nodig extra lijnen toe. Vertrouw niet alleen op de spudpaal. Zeker luiken, zonnepanelen, schoorstenen, koekoek, ankergerei en losse spullen. Zet het roer vast, voorkom klapperende onderdelen en houd dekverlichting gereed.'
  },
  {
    id: 'HB-STROOMUITVAL', type: 'Storingskaart', title: '230 V uitval en omvormer overload',
    status: 'Historische procedure - actuele installatie leidend', tags: ['stroomuitval','230v','omvormer','overload','scheidingstrafo','victron'],
    text: 'Controleer eerst stoppen, walstroombeveiliging, scheidingstrafo en aardlekschakelaars zonder beschermingen te overbruggen. Het oude handboek noemt: omvormers uit, scheidingstrafo uit, een minuut wachten, scheidingstrafo aan en daarna omvormers aan. Pas dit alleen toe als de huidige installatie en Victron-handleiding deze volgorde bevestigen.'
  },
  {
    id: 'SCHEMA-ELEKTRA', type: 'Schema', title: 'Eenvoudig schema 24 V en 230 V',
    status: 'Concept - kabels, zekeringen en omschakeling verifieren', tags: ['schema','24v','230v','victron','walstroom','generator','accu','mppt'],
    text: 'Bronnen: walstroom en Westerbeke generator voeden via beveiliging en omschakeling de 230 V-verdeling en de twee Victron Multi omvormer/laders. De Multi\'s laden de 24 V-serviceaccubank en leveren 230 V bij afwezigheid van wal of generator. Zonnepanelen lopen via MPPT-regelaars naar 24 V. De 24 V-accubank voedt via hoofdschakelaars en zekeringen het 24 V-verdeelbord. Startaccu\'s, Cyrix/scheidingsrelais, aardlek, scheidingstrafo en generatorstartaccu moeten afzonderlijk worden ingemeten en bevestigd.'
  },
  {
    id: 'SCHEMA-KLIMAAT', type: 'Schema', title: 'Sola 15 met Mar-IX verwarmen koelen en douche',
    status: 'Concept - hydrauliek en fabrikantgegevens nodig', tags: ['schema','sola 15','mar-ix','verwarmen','koelen','douche','warm water'],
    text: 'De Sola 15 bevat het buffervolume; plan daarom geen los buffervat. Conceptueel levert de Mar-IX warmte of koude aan het afgiftecircuit, terwijl de Sola 15 tapwater voor de douche bereidt en als hydraulisch middelpunt fungeert. Leg aanvoer, retour, pompen, mengklep, expansie, ontluchting, condensafvoer, vorstbeveiliging en prioriteit voor tapwater vast volgens beide fabrikantenschema\'s.'
  },
  {
    id: 'SCHEMA-WATER', type: 'Schema', title: 'Drinkwater en vuilwater met keuken badkamer en roef',
    status: 'Concept - actuele leidingloop inmeten', tags: ['schema','drinkwater','vuilwater','wasmachine','vaatwasser','douche','wc','bijkeuken','roef'],
    text: 'Drinkwater: tanks naar afsluiters en filter, drukpomp, koudwaterverdeling en via Sola 15 naar warmwaterpunten. Verbruikers: keuken, vaatwasser, wasmachine, douche, wastafels, wc indien van toepassing en toekomstige bijkeuken in de roef. Vuilwater: keuken en apparaten via passende sifon/terugslagvoorziening; douche naar opvangtank/pomp; toilet via geschikte Sani/versnijdingsroute; vervolgens naar vuilwatertank en alleen via wettelijk toegestane afvoer. Neem ontluchting, hoogwateralarm, reinigingspunten en handbediening op.'
  }
];
