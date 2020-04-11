# covid-self-report
## Github action to generate datasets

This github action can automatically generate datasets based on collected data. It will generate 3 kinds of files:
- globally merged data which takes all daily changes (daily variations) and appends them in a single CSV file. Tracks all variations since the beginning, also known as `merge-all-days.csv`
- Daily changes from the start, tracks all variations and merge them with previous data, same as daily changes but aggregated across time, one CSV file per day, also known as `daily-reports`
- Daily changes, tracks all variations and write them to CSV files one per day

### Action configuration
This action can be configured with the following variables:
- `daily_export_json_url` **required** which is your firebase daily json exporting function URL
- `geo_locations_csv_url` ** required** which is the URL to the geolocation file for your instance (github raw)
- `daily_export_json_token` **required** the security token to access the json export function, **AS SECRET**
- `merged_dataset_name` the name of the globally merged dataset file, by default `merge-all-days.csv`
- `daily_report_name` the name of the daily reports, by default is `daily-changes/{date}.csv` where `date` is replaced by YEAR-MONTH-DAY. This means you'll have one file per day in a daily-reports directory
- `daily_merged_report_name` the name of the aggregated daily reports, by default `daily-reports/{date}.csv` where `date` is replaced by YEAR-MONTH-DAY. This means you'll have one file per day in a daily-aggregated directory
- `csv_separator`, by default `,`
- `today_filename` filename of the today file (to have a unique route to latest data)

### Using this action
1. You should have a repository dedicated for your datasets.
2. In your project, create a new `.github/workflows/main.yml` file
3. Put the following content in it
```yml
on:
    schedule:
        - cron: '0 * * * *' # runs the aggregation every hour

jobs:
    aggregate:
        runs-on: ubuntu-latest
        name: Automatic datasets generation
        steps:
            - name: Checkout
              uses: actions/checkout@v2
            - name: aggregation
              uses: ch-covid-19/data-github-action@master
              with:
                  daily_export_json_url: #...
                  geo_locations_csv_url: #...
                  daily_export_json_token: ${{ secrets.readToken }}
                  # Put other variables value here if you want
            - name: Commit changes
              run: |
                  git config --local user.email "YOUR EMAIL ADDRESS"
                  git config --local user.name "YOUR PSEUDO"
                  git add .
                  git commit -m "performed automatic datasets generation"
            - name: Push changes
              uses: ad-m/github-push-action@master
              with:
                  github_token: ${{ secrets.GITHUB_TOKEN }}
```

4. In order for the action to work properly, your project structure MUST match what you've defined in the action configuration variables. For example, if you use default values for `daily_report_name` and `daily_merged_report_name`,
the action will try to write in `daily-reports` and `daily-changes` directories, if those don't exist the action will crash. To take care of this, you can create those directories and add a `.gitkeep` file in both of them, this will make sure they
exist on github.

5. Push to your dataset repository and go to Actions tab to see it working!

### Managing secrets
Github secrets are a way to provide secret data to your actions without writing them directly in your workflow yml file (and thus making it available for everyone). Instead you can use the `${{ secrets.mySecret }}` template code to dynamically provide them.
To create a secret:
- go to your datasets repository settings (where the action will work)
- On the left menu go to secrets
- From there you can add and manage secrets, you can then easily add a readToken secret
