const fs = require('fs');
const core = require('@actions/core');
const { HttpClient } = require('@actions/http-client');

const pad0 = n => n < 10 ? `0${n}` : `${n}`;
const getDayStamp = (date) => date.getFullYear() + '-' + pad0(date.getMonth() + 1) + '-' +  pad0(date.getDate());
const numberOfDiagnostics = 6;
const numberOfMetadataRows = 2;
const csvHeader = [
  'date',
  'postal_code',
  'healthy',
  'sick_guess_no_corona',
  'sick_guess_corona',
  'sick_corona_confirmed',
  'recovered_confirmed',
  'recovered_not_confirmed'
];

const emptyDiagnosticRow = Array.from(Array(numberOfDiagnostics).keys()).map(() => 0);

const httpClient = new HttpClient();
const daystamp = getDayStamp(new Date());
const exportUrl = core.getInput('daily_export_json_url');
const exportToken = core.getInput('daily_export_json_token');
const mergedDatasetFilename = core.getInput('merged_dataset_name');
const dailyReportName = core.getInput('daily_report_name').replace('{date}', daystamp);
const dailyMergedReportName = core.getInput('daily_merged_report_name');

/**
 * Loads a CSV file and maps it to a multidimensional array
 * @param file
 * @returns {string[][]}
 */
const loadCSVFile = (file) => {
  const rawData = fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : csvHeader.join(',');
  return rawData.split('\n').filter(it => it.trim() !== '')
      .map(it => it.split(','));
};

/**
 * Maps an array to its CSV counterpart
 * @param json
 * @returns {string}
 */
const toCsv = (json) => json.map(it => it.join(',')).join('\n');

/**
 * Updates the given dataset with the given daily changes
 * @param dailyChanges
 * @param dataset
 * @param indexPredicate used in order to find correct dataset row based on current daily change (current dataset item, daystamp, dailychange locator) => BOOLEAN
 * @param op used to decide what to do with previous dataset diagnostic count when adding current daily change, (current dataset value, daily change value) => INTEGER
 * @returns {*}
 */
const dailyChangesUpdateDataset = (dailyChanges, dataset, indexPredicate, op) => {
  dailyChanges.forEach(({ locator, daystamp, diagnostics }) => {
    const rowIndex = dataset.findIndex((it) => indexPredicate(it, daystamp, locator));
    const row = rowIndex === -1 ? [daystamp, locator, ...emptyDiagnosticRow] : dataset[rowIndex];

    Object.entries(diagnostics).forEach(([diagnosticId, diagnosticCount]) => {
      const did = numberOfMetadataRows + parseInt(diagnosticId, 10);
      row[did] = op(parseInt(row[did], 10), diagnosticCount);
    });

    if (rowIndex === -1) dataset.push(row);
    else dataset[rowIndex] = row;
  });

  return dataset;
};

/**
 * Will update merged changes CSV file with current daily changes
 * @param dailyChanges
 */
const buildAllMergedChanges = async (dailyChanges) => {

  const mergedChanges = loadCSVFile(`./${mergedDatasetFilename}`);
  const updatedChanges = dailyChangesUpdateDataset(dailyChanges, mergedChanges,
      (it, daystamp, locator) => it[0] === daystamp && it[1] === locator,
      (previousValue, dailyChangeValue) => dailyChangeValue // We only keep daily change value as there's one row per postal code X daystamp
  );
  fs.writeFileSync(`./${mergedDatasetFilename}`, toCsv(updatedChanges), 'utf-8');
};

const buildDailyMergedChanges = async (dailyChanges) => {
  const yesterday = (d => new Date(d.setDate(d.getDate()-1)))(new Date);
  const yesterdayChanges = loadCSVFile(`./${dailyMergedReportName.replace('{date}', getDayStamp(yesterday))}`);
  const todayChanges = yesterdayChanges.map(it => yesterdayChanges.indexOf(it) === 0 ? it : [daystamp, ...it.slice(1)]);

  const updatedChanges = dailyChangesUpdateDataset(dailyChanges, todayChanges, (it, daystamp, locator) => it[1] === locator, (a, b) => a + b);
  fs.writeFileSync(`./${dailyMergedReportName.replace('{date}', daystamp)}`, toCsv(updatedChanges), 'utf-8');
};

const buildDailyChanges = async (dailyChanges) => {
  const changes = [csvHeader];
  dailyChanges.forEach(({ locator, daystamp, diagnostics }) => {
    const row = [daystamp, locator, ...emptyDiagnosticRow];
    Object.entries(diagnostics).forEach(([diagnosticId, diagnosticCount]) => {
      row[numberOfMetadataRows + parseInt(diagnosticId, 10)] += diagnosticCount;
    });
    changes.push(row);
  });

  const dailyChangeCsv = changes.map(it => it.join(',')).join('\n');
  fs.writeFileSync(`./${dailyReportName}`, dailyChangeCsv, 'utf-8');
};

try {
  console.log('Starting daily aggregation at [' + new Date().toTimeString() + '] for [' + daystamp + ']');

  (async () => {
    const currentDailyChangesResponse = await httpClient.get(exportUrl + `?token=${exportToken}&date=${daystamp}`);
    const currentDailyChanges = JSON.parse(await currentDailyChangesResponse.readBody());

    console.log('Building new merged changes file...');
    await buildAllMergedChanges(currentDailyChanges);

    console.log('Building daily changes file...');
    await buildDailyChanges(currentDailyChanges);

    console.log('Building merged daily changes file...');
    await buildDailyMergedChanges(currentDailyChanges);

    console.log('Done');
  })();
} catch (e) {
  core.setFailed(e);
}
