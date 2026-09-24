import test from 'node:test';
import assert from 'node:assert/strict';
import { validate, publicItems } from '../src/model.js';
import { dateInfo } from '../src/schedules.js';

const dedication = (data = {}) => ({
  kind: 'dedication',
  status: 'published',
  data: { sponsorshipDate: '2026-09-24', timing: 'civil', ...data },
});

test('a dedication can publish without a sponsor or anonymous selection', () => {
  const item = validate(dedication({ sponsor: '  ', anonymous: false, dedicationName: 'לזכות הקהילה' }));
  assert.equal(item.data.sponsor, '');
  assert.equal(item.data.anonymous, false);
  assert.equal(item.startsAt, dateInfo('2026-09-24').civilStart);
  assert.equal(item.endsAt, dateInfo('2026-09-24').civilEnd);
  assert.equal(publicItems([item], item.startsAt).length, 1);
});

test('dedication text or an additional message can publish without either name', () => {
  for (const content of [
    { dedicationText: 'לזכות כל לומדי בית המדרש\nולהצלחת כל הקהילה\nבברכת שנה טובה' },
    { message: 'לזכות כל לומדי בית המדרש' },
  ]) {
    const item = validate(dedication(content));
    assert.equal(item.data.sponsor, '');
    assert.equal(item.data.dedicationName, '');
    assert.equal(item.data.anonymous, false);
    assert.equal(publicItems([item], item.startsAt).length, 1);
  }
});

test('publishing still requires a sponsorship date and meaningful dedication content', () => {
  assert.throws(() => validate(dedication({ sponsorshipDate: '', dedicationText: 'For the community' })), /sponsorship date/);
  for (const data of [{}, { dedicationName: '  ', dedicationText: '\n ', message: '\t' }, { sponsor: 'A family', anonymous: true }]) {
    assert.throws(() => validate(dedication(data)), /dedication name, dedication text or additional message/);
  }
  assert.doesNotThrow(() => validate({ ...dedication(), status: 'draft' }));
});

test('an existing anonymous sponsor remains private with a text-only dedication', () => {
  const item = validate({
    ...dedication({ sponsor: 'PRIVATE FAMILY', anonymous: true, dedicationText: 'לזכות כל הקהילה' }),
    internalName: 'PRIVATE BOOKKEEPING',
  });
  assert.equal(item.data.sponsor, 'PRIVATE FAMILY');
  const [visible] = publicItems([item], item.startsAt);
  assert.equal(visible.data.anonymous, true);
  assert.equal(Object.hasOwn(visible.data, 'sponsor'), false);
  assert.equal(Object.hasOwn(visible, 'internalName'), false);
  assert.equal(JSON.stringify(visible).includes('PRIVATE'), false);
});
