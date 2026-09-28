window.VMMS_ASSISTANT_DIAGRAMS = {
  electric: {
    title: 'Stroom: 24 V en 230 V',
    status: 'Concept — controleer beveiligingen, kabels en omschakeling aan boord',
    rows: [
      ['Walstroom of Westerbeke generator', 'Beveiliging en omschakeling', '230 V verdeling en verbruikers'],
      ['230 V verdeling', 'Victron Multi: laden', '24 V serviceaccu'],
      ['24 V serviceaccu', 'Victron Multi: omvormen', '230 V verdeling'],
      ['Zonnepanelen', 'MPPT-regelaars', '24 V serviceaccu en verdeling']
    ],
    unknown: 'Scheidingstrafo, aardlek, zekeringen, startaccu’s en exacte kabelroutes.'
  },
  climate: {
    title: 'Sola 15, Mar-IX en douche',
    status: 'Concept — fabrikantenschema’s en werkelijke leidingloop zijn leidend',
    rows: [
      ['Mar-IX verwarmen/koelen', 'Sola 15 met ingebouwd buffervolume', 'Verwarmings- of koelcircuit'],
      ['Drinkwater koud', 'Sola 15: warm tapwater', 'Douche en andere tappunten']
    ],
    unknown: 'Geen extra buffervat getekend. Pompen, kleppen, expansie, condens, vorstbeveiliging en tapwaterprioriteit.'
  },
  water: {
    title: 'Drinkwater en vuilwater',
    status: 'Concept — afvoer en toevoer per toestel aan boord controleren',
    rows: [
      ['Drinkwatertanks', 'Filter en drukpomp', 'Koudwaterpunten + Sola 15 voor warm water'],
      ['Douche', 'Opvangtank en pomp', 'Vuilwatertank'],
      ['WC', 'Sanitoilet / versnijdingsroute', 'Vuilwatertank'],
      ['Wasmachine, vaatwasser, bijkeuken roef', 'Aansluiting nog te bevestigen', 'Passende vuilwaterafvoer']
    ],
    unknown: 'Werkelijke leidingen, afsluiters, terugslagbeveiliging, ontluchting en hoogwateralarm.'
  }
};
