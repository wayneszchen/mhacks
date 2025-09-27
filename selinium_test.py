from selenium import webdriver
from selenium.webdriver.common.by import By
from bs4 import BeautifulSoup
import time
import pandas as pd
# Step 1: Set up Selenium WebDriver

df = pd.read_csv("google_engineers.csv")
urls = df['profile_link'].tolist()

driver = webdriver.Chrome()  # Or your preferred driver
driver.get("https://www.linkedin.com/login")

# Step 2: Log in
username = driver.find_element(By.ID, "username")
password = driver.find_element(By.ID, "password")

username.send_keys("linusaw@umich.edu")
password.send_keys("Z512131987!")

driver.find_element(By.XPATH, "//button[@type='submit']").click()
time.sleep(5)  # wait for login

# Step 3: Navigate to profile



#for loop over all linkedin URLS
results = []
for url in urls:
    profile_url = f"{url}"
    driver.get(profile_url)
    time.sleep(5)  # wait for JS to load
    html = driver.page_source
    soup = BeautifulSoup(html, "html.parser")

    # Step 5: Extract data
    name = soup.find("h1").get_text(strip=True)
    print("Name:", name)
    headline = soup.find("div", {"class": "text-body-medium"}).get_text(strip=True)
    print("Headline:", headline)



    # Find education by heading text
    education_header = soup.find("h2", string=lambda t: t and "Education" in t)
    schools = []
    if education_header:
        education_section = education_header.find_parent("section")
        if education_section:
            for school in education_section.find_all("li"):
                schools.append(school.get_text(" ", strip=True))
    else:
        print("Education NOT found")

    # Find experience by heading text
    experience_header = soup.find("h2", string=lambda t: t and "Experience" in t)
    jobs = []
    if experience_header:
        experience_section = experience_header.find_parent("section")
        if experience_section:
            for job in experience_section.find_all("li"):
                jobs.append(job.get_text(" ", strip=True))
    else:
        print("Experience NOT found")

    results.append({
        "name": name,
        "headline": headline,
        "schools": "; ".join(schools),
        "jobs": "; ".join(jobs)
    })

    
    
    


output = pd.DataFrame(results)
output.to_csv("scraped_profiles.csv", index=False)
# Step 4: Get HTML and parse with BeautifulSoup


driver.quit()