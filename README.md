# covid-self-report
## Github action to generate datasets

This github action can automatically generate datasets based on collected data. It will generate 3 kinds of files:
- globally merged data which takes all daily changes (daily variations) and appends them in a single CSV file. Tracks all variations since the beginning
- Daily changes, tracks all variations and write them to CSV files one per day
- Aggregated daily changes, tracks all variations and merge them with previous data, same as daily changes but aggregated across time, one CSV file per day

### Action configuration
This action can be configured with the following variables:
- `daily_export_json_url` **required** which is your firebase daily json exporting function URL
- `daily_export_json_token` **required** the security token to access the json export function
- `merged_dataset_name` the name of the globally merged dataset file
- `daily_report_name` the name of the daily reports, by default is `daily-reports/{date}.csv` where `date` is replaced by YEAR-MONTH-DAY. This means you'll have one file per day in a daily-reports directory
- `daily_merged_report_name` the name of the aggregated daily reports, by default `daily-aggregated/{date}.csv` where `date` is replaced by YEAR-MONTH-DAY. This means you'll have one file per day in a daily-aggregated directory

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
                  daily_export_json_token: #...
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
the action will try to write in `daily-reports` and `daily-aggregated` directories, if those don't exist the action will crash. To take care of this, you can create those directories and add a `.gitkeep` file in both of them, this will make sure they
exist on github.

5. Push to your dataset repository and go to Actions tab to see it working!
