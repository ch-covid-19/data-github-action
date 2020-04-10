const fs = require('fs');
const core = require('@actions/core');
const { HttpClient } = require('@actions/http-client');

const pad0 = n => n < 10 ? `0${n}` : `${n}`;
const getDayStamp = (date) => date.getFullYear() + '-' + pad0(date.getMonth() + 1) + '-' +  pad0(date.getDate());
const numberOfDiagnostics = 6;
const numberOfMetadataRows = 4;
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
const now = new Date();
const daystamp = getDayStamp(now);
const yesterday = (d => new Date(d.setDate(d.getDate()-1)))(new Date);
const yestedaystamp = getDayStamp(yesterday);
const exportUrl = core.getInput('daily_export_json_url');
const geolocationUrl = core.getInput('geo_locations_csv_url');
const exportToken = core.getInput('daily_export_json_token');
const mergedDatasetFilename = core.getInput('merged_dataset_name');
const dailyReportName = core.getInput('daily_report_name').replace('{date}', daystamp);
const dailyMergedReportName = core.getInput('daily_merged_report_name');
const csvSeparator = core.getInput('csv_separator');
const todayFilename = core.getInput('today_filename');

const getGeocoding = async () => {
  const response = await httpClient.get(geolocationUrl);
  const rawData = await response.readBody();
  return rawData.split('\n').map((it) => it.split(csvSeparator)).map(([a,b,c,d]) => [b,d,c]);
};

/**
 * Loads a CSV file and maps it to a multidimensional array
 * @param file
 * @returns {string[][]}
 */
const loadCSVFile = (file) => {
  const rawData = fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : csvHeader.join(',');
  return rawData.split('\r\n').filter(it => it.trim() !== '')
      .map(it => it.split(','));
};

/**
 * Maps an array to its CSV counterpart
 * @param json
 * @returns {string}
 */
const toCsv = (json) => json.map(it => it.join(',')).join('\r\n');

try {
  console.log('Starting daily aggregation at [' + new Date().toTimeString() + '] for [' + daystamp + ']');

  (async () => {

    const currentDailyChangesResponse = await httpClient.get(exportUrl + `?token=${exportToken}&date=${daystamp}`);
    const currentDailyChanges = JSON.parse(await currentDailyChangesResponse.readBody());
    const geocoding = await getGeocoding();
    const unknownNpas = loadCSVFile('./unknown-geocoding.csv');

    const getLatLong = (locator) => {
      const item = geocoding.find((it) => it[0] === locator);
      if (item === undefined) {
        if (!unknownNpas.includes(locator)) unknownNpas.push(locator);
        return null;
      }
      return [item[1], item[2]];
    };

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
        const yesterdayRowIndex = dataset.findIndex((it) => indexPredicate(it, yestedaystamp, locator));
        const latLong = getLatLong(locator);

        // If this geocoding locator is known
        if (latLong !== null) {
          const row = yesterdayRowIndex === -1
              ? [daystamp, locator, ...latLong, ...emptyDiagnosticRow]  // No data for yesteday create empty row
              : [...dataset[yesterdayRowIndex]]; // Already data for yesterday reuse it
          row[0] = daystamp;
          Object.entries(diagnostics).forEach(([diagnosticId, diagnosticCount]) => {
            let finalId = diagnosticId;
            if (diagnosticId === '4') finalId = '5';
            if (diagnosticId === '5') finalId = '4';
            const did = numberOfMetadataRows + parseInt(finalId, 10);
            row[did] = op(parseInt(row[did], 10), diagnosticCount);
          });

          if (rowIndex === -1) dataset.push(row);
          else dataset[rowIndex] = row;
        }
      });

      return dataset;
    };

    /**
     * Will update merged changes CSV file with current daily changes
     */
    const buildAllMergedChanges = async () => {
      const mergedChanges = loadCSVFile(`./${mergedDatasetFilename}`);
      const npasRaw = mergedChanges.slice(1).map((it) => it[1]);
      const npas = npasRaw.filter((v,i) => npasRaw.indexOf(v) === i);
      const updatedChanges = dailyChangesUpdateDataset(currentDailyChanges, mergedChanges,
          (it, daystamp, locator) => it[0] === daystamp && it[1] === locator,
          (previousValue, dailyChangeValue) => previousValue + dailyChangeValue // We only keep daily change value as there's one row per postal code X daystamp
      );

      // Take back state from yesterday from all npa's that didn't change today
      const npasPresent = currentDailyChanges.map((it) => it.locator);
      const unchangedNpas = npas.filter((it) => !npasPresent.includes(it));

      // Append state
      const yesterdayStamp = getDayStamp(yesterday);
      unchangedNpas.forEach((locator) => {
        const row = updatedChanges.find((it) => it[0] === yesterdayStamp && it[1] === locator);

        if (row !== undefined) {
          const newRow = [...row];
          newRow[0] = daystamp;

          if (locator === '3966') {
            console.log(row, newRow);
          }
          updatedChanges.push(newRow);
        }
      });
      fs.writeFileSync(`./test-${mergedDatasetFilename}`, toCsv(updatedChanges), 'utf-8');
    };

    const buildDailyMergedChanges = async () => {
      const yesterdayChanges = loadCSVFile(`./${dailyMergedReportName.replace('{date}', getDayStamp(yesterday))}`);
      const todayChanges = yesterdayChanges.map(it => yesterdayChanges.indexOf(it) === 0 ? it : [daystamp, ...it.slice(1)]);
      const updatedChanges = dailyChangesUpdateDataset(currentDailyChanges, todayChanges, (it, daystamp, locator) => it[1] === locator, (a, b) => a + b);
      const filecontent = toCsv(updatedChanges);
      fs.writeFileSync(`./${dailyMergedReportName.replace('{date}', daystamp)}`, filecontent, 'utf-8'); // write daily report
      fs.writeFileSync(`./${todayFilename}`, filecontent); // write today file
    };

    const buildDailyChanges = async () => {
      const changes = [csvHeader];
      currentDailyChanges.forEach(({ locator, daystamp, diagnostics }) => {
        const row = [daystamp, locator, ...emptyDiagnosticRow];
        Object.entries(diagnostics).forEach(([diagnosticId, diagnosticCount]) => {
          row[numberOfMetadataRows + parseInt(diagnosticId, 10)] += diagnosticCount;
        });
        changes.push(row);
      });

      const dailyChangeCsv = changes.map(it => it.join(',')).join('\n');
      fs.writeFileSync(`./${dailyReportName}`, dailyChangeCsv, 'utf-8');
    };


    /**
     * Running scripts one by one to avoid running out of memory
     */
    console.log('Building new merged changes file...');
    await buildAllMergedChanges();

    console.log('Building daily changes file...');
    await buildDailyChanges();

    console.log('Building merged daily changes file...');
    await buildDailyMergedChanges();

    // Update last-update
    fs.writeFileSync('./last-update.txt', `${now.toLocaleDateString()} ${now.toLocaleTimeString()}`, 'utf-8');
    console.log('Done');
  })();
} catch (e) {
  core.setFailed(e);
}
