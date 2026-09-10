export type StructuredContactRole =
  | 'legal_representative'
  | 'administrator'
  | 'beneficial_owner';

export type StructuredSubjectType = 'persona_fisica' | 'societa';

export type StructuredContact = {
  nome: string;
  cognome: string;
  email: string;
  cellulare: string;
};

export type StructuredCompanyContact = {
  denominazione_societa: string;
  partita_iva: string;
  legale_rappresentante_nome: string;
  legale_rappresentante_cognome: string;
  legale_rappresentante_email: string;
  legale_rappresentante_cellulare: string;
};

export type StructuredSubject = StructuredContact & StructuredCompanyContact & {
  subject_type: StructuredSubjectType;
  roles: StructuredContactRole[];
};

export type StructuredContactsResponse = {
  legal_representative: StructuredContact;
  administrator: StructuredContact;
  beneficial_owners: StructuredSubject[];
  subjects?: StructuredSubject[];
};

const CONTACT_ROLES: StructuredContactRole[] = [
  'legal_representative',
  'administrator',
  'beneficial_owner',
];

export const emptyStructuredContact = (): StructuredContact => ({
  nome: '',
  cognome: '',
  email: '',
  cellulare: '',
});

export const emptyStructuredCompanyContact = (): StructuredCompanyContact => ({
  denominazione_societa: '',
  partita_iva: '',
  legale_rappresentante_nome: '',
  legale_rappresentante_cognome: '',
  legale_rappresentante_email: '',
  legale_rappresentante_cellulare: '',
});

export const emptyStructuredSubject = (
  roles: StructuredContactRole[] = CONTACT_ROLES,
  subjectType: StructuredSubjectType = 'persona_fisica',
): StructuredSubject => ({
  ...emptyStructuredContact(),
  ...emptyStructuredCompanyContact(),
  subject_type: subjectType,
  roles: [...roles],
});

const parseContact = (value: unknown): StructuredContact => {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    nome: String(raw.nome ?? ''),
    cognome: String(raw.cognome ?? ''),
    email: String(raw.email ?? ''),
    cellulare: String(raw.cellulare ?? ''),
  };
};

export const parseStructuredSubject = (
  value: unknown,
  fallbackRoles: StructuredContactRole[] = [],
): StructuredSubject => {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const roles = Array.isArray(raw.roles)
    ? raw.roles.filter((role): role is StructuredContactRole => CONTACT_ROLES.includes(String(role) as StructuredContactRole))
    : fallbackRoles;
  const subjectType: StructuredSubjectType = raw.subject_type === 'societa'
    ? 'societa'
    : 'persona_fisica';

  return {
    ...parseContact(raw),
    denominazione_societa: String(raw.denominazione_societa ?? ''),
    partita_iva: String(raw.partita_iva ?? ''),
    legale_rappresentante_nome: String(raw.legale_rappresentante_nome ?? ''),
    legale_rappresentante_cognome: String(raw.legale_rappresentante_cognome ?? ''),
    legale_rappresentante_email: String(raw.legale_rappresentante_email ?? ''),
    legale_rappresentante_cellulare: String(raw.legale_rappresentante_cellulare ?? ''),
    subject_type: subjectType,
    roles: subjectType === 'societa' ? ['beneficial_owner'] : [...roles],
  };
};

export const readStructuredContacts = (
  response?: Record<string, unknown> | null,
): StructuredContactsResponse => {
  const owners = Array.isArray(response?.beneficial_owners)
    ? response.beneficial_owners.map(owner => parseStructuredSubject(owner, ['beneficial_owner']))
    : [];

  return {
    legal_representative: parseContact(response?.legal_representative),
    administrator: parseContact(response?.administrator),
    beneficial_owners: owners.length > 0
      ? owners
      : [emptyStructuredSubject(['beneficial_owner'])],
    subjects: Array.isArray(response?.subjects)
      ? response.subjects.map(subject => parseStructuredSubject(subject))
      : undefined,
  };
};

const hasPersonData = (contact: StructuredContact) => (
  Object.values(contact).some(value => value.trim())
);

export const getStructuredSubjects = (
  response?: Record<string, unknown> | null,
): StructuredSubject[] => {
  const contacts = readStructuredContacts(response);
  if (contacts.subjects && contacts.subjects.length > 0) return contacts.subjects;

  const subjects: StructuredSubject[] = [];
  const addLegacyPerson = (contact: StructuredContact, role: StructuredContactRole) => {
    if (!hasPersonData(contact)) return;
    const existing = subjects.find(subject => (
      subject.subject_type === 'persona_fisica'
      && subject.nome === contact.nome
      && subject.cognome === contact.cognome
      && subject.email === contact.email
      && subject.cellulare === contact.cellulare
    ));
    if (existing) {
      existing.roles = [...new Set([...existing.roles, role])];
      return;
    }
    subjects.push({
      ...emptyStructuredSubject([role]),
      ...contact,
    });
  };

  addLegacyPerson(contacts.legal_representative, 'legal_representative');
  addLegacyPerson(contacts.administrator, 'administrator');
  contacts.beneficial_owners.forEach(owner => {
    if (owner.subject_type === 'societa') {
      subjects.push({ ...owner, roles: ['beneficial_owner'] });
      return;
    }
    addLegacyPerson(owner, 'beneficial_owner');
  });

  return subjects.length > 0 ? subjects : [emptyStructuredSubject()];
};

export const isStructuredSubjectComplete = (subject: StructuredSubject): boolean => {
  if (subject.subject_type === 'societa') {
    return [
      subject.denominazione_societa,
      subject.partita_iva,
      subject.legale_rappresentante_nome,
      subject.legale_rappresentante_cognome,
      subject.legale_rappresentante_email,
      subject.legale_rappresentante_cellulare,
    ].every(value => value.trim());
  }

  return [
    subject.nome,
    subject.cognome,
    subject.email,
    subject.cellulare,
  ].every(value => value.trim());
};

const toPersonContact = (subject?: StructuredSubject): StructuredContact => (
  subject && subject.subject_type === 'persona_fisica'
    ? {
        nome: subject.nome,
        cognome: subject.cognome,
        email: subject.email,
        cellulare: subject.cellulare,
      }
    : emptyStructuredContact()
);

export const buildStructuredContactsResponse = (
  subjects: StructuredSubject[],
): StructuredContactsResponse => ({
  subjects,
  legal_representative: toPersonContact(
    subjects.find(subject => subject.roles.includes('legal_representative')),
  ),
  administrator: toPersonContact(
    subjects.find(subject => subject.roles.includes('administrator')),
  ),
  beneficial_owners: subjects.filter(subject => subject.roles.includes('beneficial_owner')),
});
