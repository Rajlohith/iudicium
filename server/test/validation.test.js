import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { checkCaseNumberCriteria, checkSearchCriteria, searchCriteriaSchema } from '../src/services/validation.js';
import { resolveOutputFilename } from '../src/services/jobManager.js';

const dates = { from_date: '01-01-2024', to_date: '31-03-2024' };

describe('checkSearchCriteria', () => {
  it('accepts dates or a full case identity', () => {
    assert.equal(checkSearchCriteria({ db_bench: 'B', ...dates }), null);
    assert.equal(checkSearchCriteria({ db_bench: 'D', case_type: '144', case_no: '48907', case_year: '2023' }), null);
  });
  it('rejects bad input with a clear message', () => {
    assert.match(checkSearchCriteria({ db_bench: 'Z', ...dates }), /Bench/);
    assert.match(checkSearchCriteria({ db_bench: 'B' }), /Date of Order range/);
    assert.match(checkSearchCriteria({ db_bench: 'B', from_date: '01-01-2024' }), /both a From and a To/);
    assert.match(checkSearchCriteria({ db_bench: 'B', from_date: '2024-01-01', to_date: '2024-02-01' }), /DD-MM-YYYY/);
    assert.match(checkSearchCriteria({ db_bench: 'B', from_date: '01-06-2024', to_date: '01-01-2024' }), /not be after/);
    assert.match(checkSearchCriteria({ db_bench: 'B', ...dates, case_no: '12a' }), /1 to 6 digits/);
    assert.match(checkSearchCriteria({ db_bench: 'B', ...dates, case_type: '99999' }), /Unknown case type/);
    assert.match(checkSearchCriteria({ db_bench: 'B', ...dates, coram: '5' }), /coram/);
  });
  it('treats empty strings like missing values (what the form sends)', () => {
    assert.equal(checkSearchCriteria({ db_bench: 'B', from_date: '', to_date: '', case_type: '144', case_no: '1', case_year: '2023', judge: '' }), null);
  });
  it('schema accepts nulls the browser sends', () => {
    assert.equal(searchCriteriaSchema.safeParse({ db_bench: 'B', judge: null, included_sections: null }).success, true);
    assert.equal(searchCriteriaSchema.safeParse({ aliases: [] }).success, false);
  });
});

describe('checkCaseNumberCriteria', () => {
  it('needs bench, type, number and year', () => {
    assert.equal(checkCaseNumberCriteria({ db_bench: 'B', case_type: '144', case_no: '1', case_year: '2023' }), null);
    assert.match(checkCaseNumberCriteria({ db_bench: 'B', case_type: '', case_no: '1', case_year: '2023' }), /fill in/);
  });
});

describe('resolveOutputFilename', () => {
  it('adds .xlsx once, strips unsafe characters and never escapes the folder', () => {
    assert.equal(resolveOutputFilename('results'), 'results.xlsx');
    assert.equal(resolveOutputFilename('Results.XLSX'), 'Results.xlsx');
    assert.equal(resolveOutputFilename(''), 'Case_Search_Results.xlsx');
    assert.ok(!resolveOutputFilename('../../etc/passwd').includes('/'));
    assert.equal(resolveOutputFilename('..'), 'Search.xlsx');
  });
});
