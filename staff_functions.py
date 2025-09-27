from staffspy import LinkedInAccount, SolverType, DriverType, BrowserType


#CREATES A LINKEDIN ACCOUNT INSTANCE
user_name = "linusaw"

#LOGIN
def init_account():
    account = LinkedInAccount(
        driver_type=DriverType( # if issues with webdriver, specify its exact location, download link in the FAQ
            browser_type=BrowserType.CHROME,
            executable_path=f"/home/{user_name}/mhacks/chromedriver"
        ),
        #SAVES TO COOKIES
        session_file="session.pkl", # save login cookies to only log in once (lasts a week or so)
        log_level=1, # 0 for no logs
    )

# search by company
def scrape_company():
    staff = account.scrape_staff(
        company_name="openai",
        search_term="software engineer",
        location="USA",
        extra_profile_data=True, # fetch all past experiences, schools, & skills
        max_results=20, # can go up to 1000
        # block=True # if you want to block the user after scraping, to exclude from future search results
        # connect=True # if you want to connect with the users until you hit your limit
    )
# or fetch by user ids
# users = account.scrape_users(
#     user_ids=['williamhgates', 'rbranson', 'jeffweiner08']
#     # connect=True,
#     # block=True
# )

# # fetch all comments on two of Bill Gates' posts 
# comments = account.scrape_comments(
#     ['7252421958540091394','7253083989547048961']
# )

# # fetch company details
# companies = account.scrape_companies(
#     company_names=['openai', 'microsoft']
# )

# # fetch connections (also gets their contact info if available)
# connections = account.scrape_connections(
#     extra_profile_data=True,
#     max_results=50
# )

# export any of the results to csv
staff.to_csv("staff.csv", index=False)