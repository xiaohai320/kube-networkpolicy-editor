// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import i18next from 'i18next';
import { getI18n } from 'react-i18next';
import { en, initI18n, tr, zh, type Msg, type TFunc } from '@/i18n';

/** Route lookups through the live instance so interpolation is the real thing. */
const t: TFunc = (key, params) => i18next.t(key, params);

const placeholders = (value: string): string[] => (value.match(/\{\{\w+\}\}/g) ?? []).sort();
const keys = Object.keys(en) as (keyof typeof en)[];

describe('dictionaries', () => {
  it('cover the same keys in every locale', () => {
    expect(Object.keys(zh).sort()).toEqual([...keys].sort());
  });

  it('never introduce a placeholder English does not have', () => {
    for (const key of keys) {
      expect(
        placeholders(en[key]).filter(p => placeholders(zh[key]).includes(p)),
        key,
      ).toEqual(placeholders(zh[key]));
    }
  });

  it('have no empty entries', () => {
    for (const key of keys) {
      // A pure value template such as `endpoint-cidr: '{{value}}'` is deliberate,
      // so only an actually empty string is a defect here.
      expect(en[key].trim(), key).not.toBe('');
      expect(zh[key].trim(), key).not.toBe('');
    }
  });
});

describe('initI18n', () => {
  it('finishes before the caller gets control back, so the first paint is translated', () => {
    initI18n();
    expect(i18next.isInitialized).toBe(true);
    expect(document.documentElement.lang).toBe(i18next.language);
  });

  it('is safe to call twice', () => {
    initI18n();
    initI18n();
    expect(i18next.isInitialized).toBe(true);
  });

  it('binds react-i18next to this instance rather than a default copy', () => {
    initI18n();
    expect(getI18n()).toBe(i18next);
  });
});

describe('tr', () => {
  it('looks up hyphen-delimited keys verbatim instead of as nested paths', async () => {
    await i18next.changeLanguage('en');
    expect(tr(t, { key: 'summary-duplicate-ingress', params: { count: 2, suffix: 's' } })).toBe(
      '2 duplicate ingress rules',
    );
    expect(tr(t, { key: 'summary-duplicate-ingress', params: { count: 1, suffix: '' } })).toBe(
      '1 duplicate ingress rule',
    );
  });

  it('translates nested message params before splicing them in', async () => {
    await i18next.changeLanguage('en');
    const warning: Msg = {
      key: 'summary-cidr-invalid',
      params: { label: { key: 'direction-egress' }, message: { key: 'cidr-prefix-required' } },
    };
    expect(tr(t, warning)).toBe('Egress CIDR: Must include prefix length (e.g. 10.0.0.0/8)');
  });

  it('renders the same message shape in Chinese', async () => {
    await i18next.changeLanguage('zh');
    const warning: Msg = {
      key: 'summary-cidr-invalid',
      params: { label: { key: 'direction-egress' }, message: { key: 'cidr-prefix-required' } },
    };
    const rendered = tr(t, warning);
    expect(rendered).toContain(zh['direction-egress']);
    expect(rendered).toContain(zh['cidr-prefix-required']);
  });

  it('keeps YAML identifiers verbatim in both locales', async () => {
    const msg: Msg = { key: 'endpoint-service-names', params: { namespace: 'kube-system', name: 'dns' } };
    await i18next.changeLanguage('en');
    expect(tr(t, msg)).toBe('kube-system/dns');
    await i18next.changeLanguage('zh');
    expect(tr(t, msg)).toBe('kube-system/dns');
  });

  it('passes non-string interpolation values through', async () => {
    await i18next.changeLanguage('en');
    expect(tr(t, { key: 'picker-kube-dns-ports', params: { port: 53, protocol: 'UDP' } })).toBe(
      'Port 53 UDP to kube-dns',
    );
  });
});
