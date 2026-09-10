import {
  buildStructuredContactsResponse,
  emptyStructuredSubject,
  getStructuredSubjects,
  isStructuredSubjectComplete,
  parseStructuredSubject,
} from '@/lib/structuredContacts';

describe('contatti strutturati dei soggetti societari', () => {
  it('interpreta i dati precedenti senza tipo come persona fisica', () => {
    const subjects = getStructuredSubjects({
      beneficial_owners: [{
        nome: 'Mario',
        cognome: 'Rossi',
        email: 'mario@example.it',
        cellulare: '3331234567',
      }],
    });

    expect(subjects[0]).toMatchObject({
      subject_type: 'persona_fisica',
      roles: ['beneficial_owner'],
      nome: 'Mario',
      cognome: 'Rossi',
    });
  });

  it('normalizza una società come solo titolare effettivo', () => {
    const subject = parseStructuredSubject({
      subject_type: 'societa',
      roles: ['administrator', 'beneficial_owner'],
      denominazione_societa: 'Holding Alfa S.r.l.',
      partita_iva: '01234567890',
    });

    expect(subject.subject_type).toBe('societa');
    expect(subject.roles).toEqual(['beneficial_owner']);
  });

  it('valida tutti i dati della società e del suo legale rappresentante', () => {
    const complete = {
      ...emptyStructuredSubject(['beneficial_owner'], 'societa'),
      denominazione_societa: 'Holding Alfa S.r.l.',
      partita_iva: '01234567890',
      legale_rappresentante_nome: 'Anna',
      legale_rappresentante_cognome: 'Bianchi',
      legale_rappresentante_email: 'anna@example.it',
      legale_rappresentante_cellulare: '3337654321',
    };

    expect(isStructuredSubjectComplete(complete)).toBe(true);
    expect(isStructuredSubjectComplete({ ...complete, partita_iva: '' })).toBe(false);
  });

  it('continua a validare nome, cognome, email e cellulare della persona fisica', () => {
    const person = {
      ...emptyStructuredSubject(['beneficial_owner']),
      nome: 'Mario',
      cognome: 'Rossi',
      email: 'mario@example.it',
      cellulare: '3331234567',
    };

    expect(isStructuredSubjectComplete(person)).toBe(true);
    expect(isStructuredSubjectComplete({ ...person, email: '' })).toBe(false);
  });

  it('mantiene nel payload il titolare effettivo società senza usarlo come amministratore', () => {
    const company = {
      ...emptyStructuredSubject(['beneficial_owner'], 'societa'),
      denominazione_societa: 'Holding Alfa S.r.l.',
      partita_iva: '01234567890',
      legale_rappresentante_nome: 'Anna',
      legale_rappresentante_cognome: 'Bianchi',
      legale_rappresentante_email: 'anna@example.it',
      legale_rappresentante_cellulare: '3337654321',
    };
    const response = buildStructuredContactsResponse([company]);

    expect(response.beneficial_owners).toEqual([company]);
    expect(response.administrator).toEqual({
      nome: '',
      cognome: '',
      email: '',
      cellulare: '',
    });
  });
});
