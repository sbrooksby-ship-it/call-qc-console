import streamlit as st
import pandas as pd
import numpy as np
import json
import plotly.express as px
import time
from google.oauth2 import service_account
from googleapiclient.discovery import build
import google.generativeai as genai

# -------------------------------------------------------------------------
# 1. PAGE CONFIGURATION & STYLING
# -------------------------------------------------------------------------
st.set_page_config(
    page_title="Call QC Console | Balance of Nature",
    page_icon="📞",
    layout="wide"
)

st.markdown("""
<style>
    /* BALANCE OF NATURE GLOBAL THEME */
    
    /* Sidebar Background */
    [data-testid="stSidebar"] {
        background-color: #f6fbf0 !important;
        border-right: 1px solid #dcf0c3;
    }
    
    /* Global Buttons */
    .stButton>button {
        background-color: #8CC63F !important;
        color: white !important;
        border: none !important;
        box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
        transition: all 0.2s;
        font-weight: 600 !important;
        text-shadow: 0px 1px 2px rgba(0,0,0,0.2);
    }
    .stButton>button:hover {
        background-color: #7ab82e !important;
        transform: translateY(-2px);
    }
    
    /* Metric Cards */
    div[data-testid="metric-container"] {
        background-color: #ffffff;
        border: 1px solid #e2e8f0;
        padding: 5% 10% 5% 10%;
        border-radius: 8px;
        border-top: 4px solid #8CC63F;
        box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1);
    }
    
    /* Style horizontal navigation radio buttons to look like tabs */
    div[data-testid="stRadio"] > div {
        flex-direction: row;
        justify-content: flex-start;
        gap: 10px;
    }
    div[data-testid="stRadio"] label {
        background-color: #ffffff;
        padding: 8px 16px;
        border-radius: 8px;
        border: 1px solid #cbd5e1;
        cursor: pointer;
        font-weight: 600;
        color: #334155;
    }
    div[data-testid="stRadio"] label:hover {
        background-color: #f6fbf0;
        border-color: #8CC63F;
        color: #7ab82e;
    }
    
    /* Print Styles */
    @media print {
        section[data-testid="stSidebar"] { display: none !important; }
        header[data-testid="stHeader"] { display: none !important; }
        div[data-testid="stAlert"] { display: none !important; } 
        div[data-testid="stCheckbox"] { display: none !important; } 
        
        @page {
            size: letter;
            margin: 10mm;
        }
        [data-testid="stAppViewContainer"] {
            zoom: 0.80 !important;
            width: 100% !important;
        }
        div[data-testid="column"] {
            break-inside: avoid !important;
        }
    }
</style>
""", unsafe_allow_html=True)

# -------------------------------------------------------------------------
# BALANCE OF NATURE LOGO HEADER (PURE CSS - GITHUB FRIENDLY!)
# -------------------------------------------------------------------------
st.markdown("""
<div style="text-align: center; margin-bottom: 25px; margin-top: -20px;">
    <h1 style="font-size: 3.5rem; margin-bottom: 0; font-family: 'Arial Black', Impact, sans-serif; letter-spacing: 2px;">
        <span style="color: #111111;">BALANCE OF N</span><span style="color: #8CC63F;">A</span><span style="color: #111111;">TURE</span>
    </h1>
    <h3 style="color: #475569; margin-top: -10px; font-weight: 400; letter-spacing: 4px; font-size: 1.2rem;">CALL QC CONSOLE</h3>
</div>
""", unsafe_allow_html=True)


# -------------------------------------------------------------------------
# GOOGLE DRIVE & GEMINI HELPER FUNCTIONS
# -------------------------------------------------------------------------
FOLDER_ID = "19SEHIDCcIdggzSVzl1dhClmHTXXqrwK9"

def get_drive_service():
    """Authenticates with Google Drive using secrets.toml."""
    try:
        creds_dict = dict(st.secrets["google_service_account"])
        if "private_key" in creds_dict:
            creds_dict["private_key"] = creds_dict["private_key"].replace("\\n", "\n")
            
        creds = service_account.Credentials.from_service_account_info(
            creds_dict,
            scopes=['https://www.googleapis.com/auth/drive.readonly']
        )
        return build('drive', 'v3', credentials=creds, cache_discovery=False)
    except Exception as e:
        st.error(f"Failed to connect to Google Drive Service: {e}")
        return None

@st.cache_data(ttl=300)
def get_drive_subfolders(folder_id):
    service = get_drive_service()
    if not service:
        return {}
    try:
        query = f"'{folder_id}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false"
        results = service.files().list(q=query, fields="files(id, name)").execute()
        folders = results.get('files', [])
        return {f['name']: f['id'] for f in folders}
    except Exception as e:
        st.error(f"Error fetching subfolders from Drive: {e}")
        return {}

@st.cache_data(ttl=300)
def fetch_all_transcripts(target_folder_id):
    """Recursively fetches text content and returns a list of dictionaries for chunking."""
    service = get_drive_service()
    if not service:
        return []
    
    def get_files_recursively(current_folder_id, path_prefix=""):
        files_list = []
        try:
            query = f"'{current_folder_id}' in parents and trashed = false"
            results = service.files().list(q=query, fields="files(id, name, mimeType)").execute()
            items = results.get('files', [])
            
            for item in items:
                if item['mimeType'] == 'application/vnd.google-apps.folder':
                    files_list.extend(get_files_recursively(item['id'], path_prefix=f"{path_prefix}{item['name']}/"))
                else:
                    file_id = item['id']
                    file_name = f"{path_prefix}{item['name']}"
                    try:
                        request = service.files().get_media(fileId=file_id)
                        content = request.execute().decode('utf-8', errors='ignore')
                        files_list.append({"file_name": file_name, "content": content})
                    except Exception:
                        pass
            return files_list
        except Exception:
            return files_list

    return get_files_recursively(target_folder_id)

# Initialize Gemini AI
if "GEMINI_API_KEY" in st.secrets:
    genai.configure(api_key=st.secrets["GEMINI_API_KEY"])
else:
    st.sidebar.warning("⚠️ GEMINI_API_KEY not found in secrets.toml")


# -------------------------------------------------------------------------
# DICTIONARY & HELPER FUNCTIONS FOR SCORECARD
# -------------------------------------------------------------------------
question_tooltips = {
    "ARC 1": "Did the team member create genuine ARC with the customer early in the call?",
    "ARC 2": "Did the team member recognize the customer's emotional state and adjust responses appropriately?",
    "ARC 3": "Maintained or raised the customer's tone throughout the call",
    "ARC 4": "Did the team member strengthen trust in Balance of Nature and its products through authentic personal experience, Success Story, or relevant examples?",
    "BG 1": "What tone did the team member communicate during the first 30 seconds of the interaction?",
    "BG 2": "Delivered the BON greeting and introduced themselves appropriately.",
    "OE 1": "Did the team member actively advocate for the customer's best interests by exploring appropriate solutions and alternatives with a level of effort and persistence suited to the customer's situation?",
    "OE 2": "Did the team member take responsibility for helping the customer rather than deflecting responsibility to others?",
    "OE 3": "Did the customer hear evidence that effort was being invested and feel that their issue mattered?",
    "PE 1": "Used information specific to the customer. Referenced customer history, goals, and concerns",
    "PE 2": "Used purposeful discovery questions to understand the customer's situation, uncover needs, and guide the conversation effectively.",
    "PE 3": "Identified the customer's success with the product (N/A for new customers)",
    "PE 4": "Did the team member effectively respond to all opportunities presented in the call to educate and find solutions to their concerns, needs, and goals?",
    "PE 5": "Did the team member identify and educate the customer on the next appropriate step in their wellness journey and current level of engagement with BON (e.g. WHS, other BON products, Plus Membership, etc.)?",
    "QC 1": "How natural, conversational, smooth, and courteous was the team member's communication?",
    "QC 2": "How well did the team member properly acknowledge the customer throughout the call?",
    "QC 3": "Communicated clearly, concisely, and fluently in a manner that was easy for the customer to understand",
    "QC 4": "Actively listened without interrupting",
    "QC 5": "Used positive and empowering language",
    "QC 6": "Demonstrated confidence and competence",
    "QC 7": "Assumed the sale and/or success with the product",
    "QC 8": "Maintained an appropriate tone throughout the interaction",
    "CL 1": "Summarized actions taken and confirmed issue resolution",
    "CL 2": "Communicated next steps clearly. The customer knows exactly what happens next.",
    "CL 3": "Asked if additional assistance was needed",
    "CL 4": "Ended the call warmly and sincerely. Thanked the customer for calling Balance of Nature.",
    "CC 1": "Effectively guided the conversation",
    "CC 2": "Maintained focus on the customer's primary concern",
    "CC 3": "Managed talk time appropriately and balanced efficiency with customer care",
    "CC 4": "Followed the established call flow",
    "CC 5": "Achieved their VFP by the end of the call",
    "COMP 1": "Properly verified the customer's account (N/A for new customers)",
    "COMP 2": "Collected or verified the customer’s email (N/A for new customers)",
    "COMP 3": "Requested the customer to take the customer satisfaction survey after the end of their call",
    "COMP 4": "Did not make any claims about Balance of Nature products treating or preventing any specific disease or condition",
    "COMP 5": "Did the team member properly identify and handle any adverse events, or product complaints that came up in the call?"
}

section_map = {
    "BG": "Beginning",
    "ARC": "ARC & Trust",
    "OE": "Ownership & Responsibility & Effort",
    "PE": "Personalization & Education",
    "QC": "Quality Communication",
    "CL": "Closing",
    "CC": "Call Control",
    "COMP": "Compliance"
}

def get_section_name(category):
    cat_upper = str(category).upper()
    for prefix, section in section_map.items():
        if cat_upper.startswith(prefix):
            return section
    return "Other"

def get_csv_url(url):
    if "/edit" in url:
        base, gid_part = url.split("/edit")
        gid = "0"
        if "#gid=" in gid_part:
            gid = gid_part.split("#gid=")[-1].split("&")[0]
        elif "?gid=" in gid_part:
            gid = gid_part.split("?gid=")[-1].split("&")[0]
        return f"{base}/export?format=csv&gid={gid}"
    return url

@st.cache_data(ttl=600)
def load_sheet_data(url):
    csv_url = get_csv_url(url)
    return pd.read_csv(csv_url)

def generate_section_summary(data_df):
    if data_df.empty:
        return pd.DataFrame()
    call_section_df = data_df.groupby(['Call', 'Section']).agg(
        Total_Score=('Score', 'sum'),
        Questions=('Score', 'count')
    ).reset_index()
    call_section_df['Max_Score'] = call_section_df['Questions'] * 5
    call_section_df['Percentage'] = (call_section_df['Total_Score'] / call_section_df['Max_Score']) * 100
    section_summary = call_section_df.groupby('Section').agg(
        Avg_Score=('Total_Score', 'mean'),
        Max_Possible=('Max_Score', 'mean'),
        Avg_Percentage=('Percentage', 'mean')
    ).reset_index()
    section_summary['Score (Raw)'] = section_summary['Avg_Score'].round(1).astype(str) + " / " + section_summary['Max_Possible'].astype(int).astype(str)
    section_summary['Percentage'] = section_summary['Avg_Percentage'].round(1).astype(str) + "%"
    section_order = ["Beginning", "ARC & Trust", "Ownership & Responsibility & Effort", 
                     "Personalization & Education", "Quality Communication", 
                     "Closing", "Call Control", "Compliance"]
    section_summary['Section'] = pd.Categorical(section_summary['Section'], categories=section_order, ordered=True)
    section_summary = section_summary.sort_values('Section').set_index('Section')
    return section_summary[['Score (Raw)', 'Percentage']]

def create_section_bar_chart(summary_df, threshold):
    """Creates a horizontal bar chart from the section summary dataframe."""
    if summary_df.empty:
        return None
        
    df_chart = summary_df.reset_index().copy()
    # Convert 'Percentage' string (e.g. '85.5%') back to a float for charting
    df_chart['Pct_Num'] = pd.to_numeric(df_chart['Percentage'].astype(str).str.replace('%', ''), errors='coerce').fillna(0)
    
    fig = px.bar(
        df_chart,
        x='Pct_Num',
        y='Section',
        orientation='h',
        text=df_chart['Percentage'],
        labels={'Pct_Num': 'Score (%)', 'Section': ''},
        range_x=[0, 100],
        color_discrete_sequence=['#8CC63F']
    )
    
    # Add a dashed target line based on the manager's Pass Threshold
    fig.add_vline(x=threshold, line_dash="dash", line_color="#dc2626", annotation_text=f"Target ({threshold}%)")
    
    fig.update_layout(
        yaxis={'categoryorder': 'array', 'categoryarray': df_chart['Section'].tolist()[::-1]},
        paper_bgcolor='rgba(0,0,0,0)',
        plot_bgcolor='rgba(0,0,0,0)',
        margin=dict(l=10, r=20, t=10, b=20),
        height=330
    )
    return fig

def generate_meter_bank(data_df, agent_filter):
    if data_df.empty:
        return pd.DataFrame().style
    if agent_filter == "All agents":
        pivot_df = data_df.pivot_table(index='Agent', columns='Category', values='Score', aggfunc='mean')
    else:
        pivot_df = data_df.pivot_table(index='Call', columns='Category', values='Score', aggfunc='mean')
    
    prefix_order = ["BG", "ARC", "OE", "PE", "QC", "CL", "CC", "COMP"]
    ordered_cols = []
    for prefix in prefix_order:
        matched = sorted([col for col in pivot_df.columns if str(col).upper().startswith(prefix)])
        ordered_cols.extend(matched)
    remaining = sorted([col for col in pivot_df.columns if col not in ordered_cols])
    ordered_cols.extend(remaining)
    
    pivot_df = pivot_df[ordered_cols]
    return pivot_df.style.background_gradient(cmap='RdYlGn', vmin=1, vmax=5).format("{:.1f}")

# -------------------------------------------------------------------------
# TOP NAVIGATION (DYNAMIC SIDEBAR SWITCHING)
# -------------------------------------------------------------------------
selected_tab = st.radio(
    "Navigation",
    ["📊 Performance Dashboard", "💬 AI Assistant", "🏷️ Tagging & Insights"],
    horizontal=True,
    label_visibility="collapsed"
)

st.divider()

# =========================================================================
# TAB 1: QC DASHBOARD
# =========================================================================
if selected_tab == "📊 Performance Dashboard":
    DEFAULT_MASTER_URL = "https://docs.google.com/spreadsheets/d/1-N0IJxjzrdM_mlmIn9QYMHj_PPMfOopP7CReYW5m5IQ/edit?gid=1001#gid=1001"
    DEFAULT_COACH_URL = "https://docs.google.com/spreadsheets/d/1-N0IJxjzrdM_mlmIn9QYMHj_PPMfOopP7CReYW5m5IQ/edit?gid=1002#gid=1002"

    st.sidebar.header("1. Connect Data")
    sheet_url = st.sidebar.text_input("1. Paste 'Master Data' Tab Link:", value=DEFAULT_MASTER_URL)
    coach_url = st.sidebar.text_input("2. Paste 'Coaching Feedback' Tab Link:", value=DEFAULT_COACH_URL)

    if sheet_url:
        try:
            raw_df = load_sheet_data(sheet_url)
            
            coach_df = pd.DataFrame()
            if coach_url:
                try:
                    coach_df = load_sheet_data(coach_url)
                    st.sidebar.success("Both sheets connected successfully!")
                except Exception:
                    st.sidebar.warning("Master Data connected. Could not load Coaching Feedback tab.")
            else:
                st.sidebar.warning("Master Data connected. Add Coaching link for 1-on-1s.")
                
            st.sidebar.divider()
            
            fixed_columns = ['Date', 'Agent Name', 'Call']
            score_columns = [col for col in raw_df.columns if col not in fixed_columns and "total" not in col.lower()]
            
            df = pd.melt(raw_df, 
                         id_vars=fixed_columns, 
                         value_vars=score_columns,
                         var_name='Category', 
                         value_name='Score')
                         
            df = df.rename(columns={'Agent Name': 'Agent'})
            df['Score'] = pd.to_numeric(df['Score'], errors='coerce').fillna(0)
            
            extracted_date = df['Date'].astype(str).str.extract(r'(\d{1,2}[-/]\d{1,2})')[0]
            extracted_date = extracted_date.str.replace('-', '/')
            df['Clean_Date'] = pd.to_datetime(extracted_date + "/2026", errors='coerce')
            
            df['Section'] = df['Category'].apply(get_section_name)
            
            call_df = df.groupby(['Clean_Date', 'Date', 'Agent', 'Call'])['Score'].sum().reset_index()
            call_df = call_df.rename(columns={'Score': 'Total Raw Score'})
            call_df['Call Percentage'] = (call_df['Total Raw Score'] / 180) * 100
            
            # FILTERS & COMPARISON MODE
            st.sidebar.header("2. Dashboard Filters")
            
            min_date = df['Clean_Date'].min()
            max_date = df['Clean_Date'].max()
            
            if pd.isna(min_date) or pd.isna(max_date):
                st.sidebar.warning("Could not parse dates for filtering.")
                start_date, end_date = None, None
            else:
                date_range = st.sidebar.date_input(
                    "SELECT DATE RANGE",
                    value=(min_date.date(), max_date.date()),
                    min_value=min_date.date(),
                    max_value=max_date.date()
                )
                if len(date_range) == 2:
                    start_date, end_date = date_range
                else:
                    start_date, end_date = date_range[0], max_date.date()

            compare_mode = st.sidebar.checkbox("⚖️ Enable Date Comparison Mode", value=False)
            start_date_2, end_date_2 = None, None
            
            if compare_mode:
                st.sidebar.markdown("**COMPARE AGAINST:**")
                date_range_2 = st.sidebar.date_input(
                    "SELECT SECOND DATE RANGE",
                    value=(min_date.date(), max_date.date()),
                    min_value=min_date.date(),
                    max_value=max_date.date()
                )
                if len(date_range_2) == 2:
                    start_date_2, end_date_2 = date_range_2
                else:
                    start_date_2, end_date_2 = date_range_2[0], max_date.date()
                    
            st.sidebar.divider()
            
            sel_agent = st.sidebar.selectbox("FILTER BY AGENT", ["All agents"] + list(df['Agent'].dropna().unique()))
            
            sel_coaching_date = "Hide 1-on-1 View"
            agent_coach_data = pd.DataFrame()
            
            if sel_agent != "All agents" and not coach_df.empty:
                if 'Agent Name' in coach_df.columns and 'Date Range' in coach_df.columns:
                    # Grab JUST the first name of the selected agent (lowercase)
                    first_name = str(sel_agent).split()[0].strip().lower()
                    
                    # Create a clean version of the coaching dataframe
                    coach_df_clean = coach_df.copy()
                    # Extract JUST the first name from the Coaching Sheet column
                    coach_df_clean['First_Name'] = coach_df_clean['Agent Name'].astype(str).apply(lambda x: x.split()[0].strip().lower() if pd.notna(x) else "")
                    
                    # Match them based on the first name!
                    agent_coach_data = coach_df_clean[coach_df_clean['First_Name'] == first_name]
                    
                    if not agent_coach_data.empty:
                        avail_dates = agent_coach_data['Date Range'].dropna().unique()
                        sel_coaching_date = st.sidebar.selectbox("🔍 SELECT COACHING DATE RANGE (1-on-1 View)", ["Hide 1-on-1 View"] + list(avail_dates))

            filtered_df = df.copy()
            filtered_call_df = call_df.copy()
            
            if start_date and end_date:
                mask = (filtered_df['Clean_Date'].dt.date >= start_date) & (filtered_df['Clean_Date'].dt.date <= end_date)
                filtered_df = filtered_df.loc[mask]
                
                call_mask = (filtered_call_df['Clean_Date'].dt.date >= start_date) & (filtered_call_df['Clean_Date'].dt.date <= end_date)
                filtered_call_df = filtered_call_df.loc[call_mask]
            
            filtered_df_2 = pd.DataFrame()
            if compare_mode and start_date_2 and end_date_2:
                mask2 = (df['Clean_Date'].dt.date >= start_date_2) & (df['Clean_Date'].dt.date <= end_date_2)
                filtered_df_2 = df.loc[mask2].copy()

            if sel_agent != "All agents":
                filtered_df = filtered_df[filtered_df['Agent'] == sel_agent]
                filtered_call_df = filtered_call_df[filtered_call_df['Agent'] == sel_agent]
                if compare_mode and not filtered_df_2.empty:
                    filtered_df_2 = filtered_df_2[filtered_df_2['Agent'] == sel_agent]

            if filtered_call_df.empty:
                st.warning("No data found for these filters.")
            else:
                # TOP KPI ROW & DELTAS
                col_empty, col_thresh = st.columns([4, 1])
                with col_thresh:
                    pass_threshold = st.number_input("PASS THRESHOLD (%)", value=80, step=1)

                total_calls = len(filtered_call_df)
                avg_call_score = filtered_call_df['Call Percentage'].mean()
                highest_score = filtered_call_df['Call Percentage'].max()
                lowest_score = filtered_call_df['Call Percentage'].min()
                
                passing_calls = len(filtered_call_df[filtered_call_df['Call Percentage'] >= pass_threshold])
                pass_rate = (passing_calls / total_calls) * 100 if total_calls > 0 else 0

                mid_point = start_date + (end_date - start_date) / 2
                first_half = filtered_call_df[filtered_call_df['Clean_Date'].dt.date <= mid_point]
                second_half = filtered_call_df[filtered_call_df['Clean_Date'].dt.date > mid_point]
                
                delta_avg = None
                delta_pass = None
                if not first_half.empty and not second_half.empty:
                    fh_avg = first_half['Call Percentage'].mean()
                    sh_avg = second_half['Call Percentage'].mean()
                    delta_avg = sh_avg - fh_avg
                    
                    fh_pass = (len(first_half[first_half['Call Percentage'] >= pass_threshold]) / len(first_half)) * 100
                    sh_pass = (len(second_half[second_half['Call Percentage'] >= pass_threshold]) / len(second_half)) * 100
                    delta_pass = sh_pass - fh_pass

                kpi1, kpi2, kpi3, kpi4, kpi5 = st.columns(5)
                kpi1.metric("CALLS GRADED", total_calls)
                
                if delta_avg is not None:
                    kpi2.metric("AVG CALL SCORE", f"{avg_call_score:.1f}%", f"{delta_avg:.1f}% vs first half")
                else:
                    kpi2.metric("AVG CALL SCORE", f"{avg_call_score:.1f}%")
                    
                kpi3.metric("HIGHEST CALL", f"{highest_score:.1f}%")
                kpi4.metric("LOWEST CALL", f"{lowest_score:.1f}%")
                
                if delta_pass is not None:
                    kpi5.metric(f"PASS RATE (>{pass_threshold}%)", f"{pass_rate:.0f}%", f"{delta_pass:.0f}% vs first half")
                else:
                    kpi5.metric(f"PASS RATE (>{pass_threshold}%)", f"{pass_rate:.0f}%")

                st.divider()

                norm_tooltips = {k.replace(" ", "").upper(): v for k, v in question_tooltips.items()}
                col_config = {}
                for col in df['Category'].unique():
                    norm_col = str(col).replace(" ", "").upper()
                    if norm_col in norm_tooltips:
                        col_config[col] = st.column_config.Column(help=norm_tooltips[norm_col])

                # 1-ON-1 COACHING VIEW vs. STANDARD DASHBOARD VIEW
                if sel_coaching_date != "Hide 1-on-1 View":
                    
                    st.info("🖨️ **How to Export this Scorecard:** Press **Ctrl + P** (or **Cmd + P** on Mac) to open the print menu, then select **'Save as PDF'**.")

                    st.markdown(f"## 📝 COACHING FEEDBACK: {sel_coaching_date}")
                    st.markdown(f"**Agent:** {sel_agent} | **Average Call Score during this period:** {avg_call_score:.1f}%")

                    # RECURRING ISSUE DETECTION
                    historical_df = df[(df['Agent'] == sel_agent) & (df['Clean_Date'].dt.date < start_date)]
                    past_fails = historical_df[historical_df['Score'].isin([1, 2])]['Category'].unique()
                    current_fails = filtered_df[filtered_df['Score'].isin([1, 2])]['Category'].unique()
                    recurring_issues = [issue for issue in current_fails if issue in past_fails]
                    
                    if recurring_issues:
                        issue_names = ", ".join([f"**{issue}**" for issue in recurring_issues])
                        st.warning(f"🔄 **Recurring Critical Issues Detected:** {issue_names} scored a 1 or 2 during this current date range AND in previous periods.")
                    
                    coach_row = agent_coach_data[agent_coach_data['Date Range'] == sel_coaching_date].iloc[0]
                    default_wins = coach_row['Top 3 Wins'] if pd.notna(coach_row.get('Top 3 Wins')) else "No wins recorded for this period."
                    default_improve = coach_row['Top 3 Areas for Improvement'] if pd.notna(coach_row.get('Top 3 Areas for Improvement')) else "No areas for improvement recorded for this period."
                    
                    state_key = f"{sel_agent}_{sel_coaching_date}"
                    if 'current_coach_view' not in st.session_state or st.session_state.current_coach_view != state_key:
                        st.session_state.current_coach_view = state_key
                        st.session_state.wins_text = default_wins
                        st.session_state.improve_text = default_improve

                    edit_mode = st.checkbox("✏️ Enable Edit Mode (Uncheck this before hitting Ctrl + P to lock in your changes for printing!)", value=False)
                    
                    col_good, col_bad = st.columns(2)
                    
                    with col_good:
                        st.success("### 🌟 Top 3 Wins")
                        if edit_mode:
                            st.session_state.wins_text = st.text_area("Edit Wins (Does not save to Sheets):", value=st.session_state.wins_text, height=350)
                        else:
                            st.markdown(st.session_state.wins_text)
                            
                    with col_bad:
                        st.error("### ⚠️ Top 3 Areas for Improvement")
                        if edit_mode:
                            st.session_state.improve_text = st.text_area("Edit Improvements (Does not save to Sheets):", value=st.session_state.improve_text, height=350)
                        else:
                            st.markdown(st.session_state.improve_text)
                            
                    st.divider()
                    st.info("To return to the main dashboard charts, change the 'Select Coaching Date Range' dropdown in the sidebar back to 'Hide 1-on-1 View'.")

                else:
                    # COMPARISON MODE RENDER
                    if compare_mode:
                        
                        col_comp_title, col_comp_toggle = st.columns([1, 1])
                        with col_comp_title:
                            st.markdown("**📑 SECTION PERFORMANCE COMPARISON**")
                        with col_comp_toggle:
                            # Add toggle for comparison mode view
                            sec_view_comp = st.radio("Display:", ["📊 Chart", "📑 Table"], horizontal=True, label_visibility="collapsed", key="comp_sec_view")
                            
                        col_sec1, col_sec2 = st.columns(2)
                        
                        with col_sec1:
                            st.markdown(f"**Period 1 ({start_date.strftime('%m/%d')} to {end_date.strftime('%m/%d')})**")
                            sum_df1 = generate_section_summary(filtered_df)
                            if sec_view_comp == "📑 Table":
                                st.dataframe(sum_df1, use_container_width=True, height=350)
                            else:
                                fig1 = create_section_bar_chart(sum_df1, pass_threshold)
                                if fig1: st.plotly_chart(fig1, use_container_width=True)
                            
                        with col_sec2:
                            st.markdown(f"**Period 2 ({start_date_2.strftime('%m/%d')} to {end_date_2.strftime('%m/%d')})**")
                            if filtered_df_2.empty:
                                st.warning("No data for this date range.")
                            else:
                                sum_df2 = generate_section_summary(filtered_df_2)
                                if sec_view_comp == "📑 Table":
                                    st.dataframe(sum_df2, use_container_width=True, height=350)
                                else:
                                    fig2 = create_section_bar_chart(sum_df2, pass_threshold)
                                    if fig2: st.plotly_chart(fig2, use_container_width=True)
                                
                        st.divider()

                        st.markdown("**((o)) METER BANK COMPARISON**")
                        st.markdown("*Legend: 🔴 Critical (1-2) | 🟡 Average (3) | 🟢 Excellent (4-5)*")
                        
                        col_mb1, col_mb2 = st.columns(2)
                        with col_mb1:
                            st.markdown(f"**Period 1 ({start_date.strftime('%m/%d')} to {end_date.strftime('%m/%d')})**")
                            st.dataframe(generate_meter_bank(filtered_df, sel_agent), use_container_width=True, height=350, column_config=col_config)
                            
                        with col_mb2:
                            st.markdown(f"**Period 2 ({start_date_2.strftime('%m/%d')} to {end_date_2.strftime('%m/%d')})**")
                            if filtered_df_2.empty:
                                st.warning("No data for this date range.")
                            else:
                                st.dataframe(generate_meter_bank(filtered_df_2, sel_agent), use_container_width=True, height=350, column_config=col_config)

                    # STANDARD MODE RENDER
                    else:
                        col_trend, col_sections = st.columns([2, 1])
                        
                        with col_trend:
                            if sel_agent == "All agents":
                                st.markdown("**📈 OVERALL AVERAGE SCORE TREND**")
                            else:
                                st.markdown(f"**📈 {sel_agent.upper()}'S SCORE TREND**")
                                
                            trend_df = filtered_call_df.groupby('Clean_Date')['Call Percentage'].mean()
                            # Updated line chart to use the matching Balance of Nature Green
                            st.line_chart(trend_df, height=350, color="#8CC63F")
        
                        with col_sections:
                            col_sec_title, col_sec_toggle = st.columns([1, 1])
                            with col_sec_title:
                                st.markdown("**📑 SECTION PERFORMANCE**")
                            with col_sec_toggle:
                                # Add toggle for standard mode view
                                sec_view_std = st.radio("Display:", ["📊 Chart", "📑 Table"], horizontal=True, label_visibility="collapsed", key="std_sec_view")
                                
                            summary_df = generate_section_summary(filtered_df)
                            
                            # Render based on user's button choice
                            if sec_view_std == "📑 Table":
                                st.dataframe(summary_df, use_container_width=True, height=330)
                            else:
                                fig = create_section_bar_chart(summary_df, pass_threshold)
                                if fig:
                                    st.plotly_chart(fig, use_container_width=True)
        
                        st.divider()
        
                        st.markdown("**((o)) METER BANK — CLICK A CELL TO FOCUS COACHING PRIORITIES**")
                        st.markdown("*Legend: 🔴 Critical (1-2) | 🟡 Average (3) | 🟢 Excellent (4-5)*")
                        st.dataframe(generate_meter_bank(filtered_df, sel_agent), use_container_width=True, height=350, column_config=col_config)

                    st.divider()

                    # LEADERBOARD & PRIORITIES
                    col_board, col_coach = st.columns([2, 1])

                    with col_board:
                        if sel_agent == "All agents":
                            st.markdown("**AGENT LEADERBOARD (PERIOD 1)**")
                        else:
                            st.markdown(f"**{sel_agent.upper()}'S OVERALL STATS (PERIOD 1)**")
                            
                        leaderboard = filtered_call_df.groupby('Agent').agg(
                            CALLS_GRADED=('Call', 'count'),
                            AVG_CALL_SCORE=('Call Percentage', 'mean')
                        )
                        
                        pass_counts = filtered_call_df[filtered_call_df['Call Percentage'] >= pass_threshold].groupby('Agent').size()
                        leaderboard['PASS RATE %'] = (pass_counts / leaderboard['CALLS_GRADED']).fillna(0) * 100
                        
                        fh_agent_scores = first_half.groupby('Agent')['Call Percentage'].mean()
                        sh_agent_scores = second_half.groupby('Agent')['Call Percentage'].mean()
                        
                        agent_deltas = sh_agent_scores - fh_agent_scores
                        leaderboard['Trend (vs First Half)'] = leaderboard.index.map(agent_deltas)
                        
                        def format_trend(x):
                            if pd.isna(x):
                                return "Not enough data"
                            elif x > 0:
                                return f"⬆️ +{x:.1f}%"
                            elif x < 0:
                                return f"⬇️ {x:.1f}%"
                            else:
                                return "➖ 0.0%"
                                
                        leaderboard['Trend (vs First Half)'] = leaderboard['Trend (vs First Half)'].apply(format_trend)
                        
                        leaderboard['AVG_CALL_SCORE'] = leaderboard['AVG_CALL_SCORE'].round(1).astype(str) + '%'
                        leaderboard['PASS RATE %'] = leaderboard['PASS RATE %'].round(0).astype(str) + '%'
                        leaderboard = leaderboard.sort_values(by='AVG_CALL_SCORE', ascending=False)
                        
                        st.dataframe(leaderboard, use_container_width=True)

                        if sel_agent != "All agents":
                            st.markdown("**INDIVIDUAL CALL BREAKDOWN (PERIOD 1)**")
                            call_breakdown = filtered_call_df[['Date', 'Call', 'Total Raw Score', 'Call Percentage']].copy()
                            
                            call_breakdown['Status'] = call_breakdown['Call Percentage'].apply(
                                lambda x: "✅ Pass" if x >= pass_threshold else "❌ Fail"
                            )
                            call_breakdown['Call Percentage'] = call_breakdown['Call Percentage'].round(1).astype(str) + '%'
                            call_breakdown = call_breakdown.sort_values(by='Date', ascending=False).set_index('Call')
                            
                            st.dataframe(call_breakdown, use_container_width=True)

                        csv_data = leaderboard.to_csv().encode('utf-8')
                        st.download_button(
                            label="📥 Download Summary CSV",
                            data=csv_data,
                            file_name="qc_summary_export.csv",
                            mime="text/csv"
                        )

                    with col_coach:
                        st.markdown("**COACHING PRIORITIES (LOWEST SCORING - PERIOD 1)**")
                        lowest_scores = filtered_df.groupby('Category')['Score'].mean().reset_index()
                        lowest_scores = lowest_scores.sort_values(by='Score', ascending=True).head(5)
                        
                        for index, row in lowest_scores.iterrows():
                            st.error(f"**{row['Category']}**  \n Avg Score: {row['Score']:.2f} / 5.0")
                            
        except Exception as e:
            st.error(f"⚠️ Unable to access Google Sheet data. Details: {e}")
            st.info("Please verify both sheets have **'Anyone with the link can view'** permissions enabled.")

    else:
        st.info("👈 Please paste your Google Sheet Share Link(s) in the sidebar to load the dashboard.")

# =========================================================================
# AI SIDEBAR & DATA LOADING (FOR AI ASSISTANT & TAGGING TABS)
# =========================================================================
else:
    st.sidebar.header("AI Transcript Vault")
    subfolders = get_drive_subfolders(FOLDER_ID)
    
    # Weekly folders first (newest to oldest), with "All Transcripts" at the very bottom
    folder_options = [f"📅 {name}" for name in sorted(subfolders.keys(), reverse=True)] + ["📁 All Transcripts (All Weeks)"]
    selected_ai_folder = st.sidebar.selectbox("Select Week to Analyze:", folder_options)

    if st.sidebar.button("🔄 Sync Drive Cache"):
        st.cache_data.clear()
        st.sidebar.success("Drive cache refreshed!")

    if selected_ai_folder == "📁 All Transcripts (All Weeks)":
        active_target_id = FOLDER_ID
    else:
        folder_name_clean = selected_ai_folder.replace("📅 ", "")
        active_target_id = subfolders.get(folder_name_clean, FOLDER_ID)
        
    transcripts_list = fetch_all_transcripts(active_target_id)
    
    # Format a string version for the chat assistant
    if not transcripts_list:
        transcripts_data_str = "No transcript files found in the selected folder."
    else:
        transcripts_data_str = "\n\n".join([f"--- TRANSCRIPT FILE: {t['file_name']} ---\n{t['content']}" for t in transcripts_list])

    # =========================================================================
    # TAB 2: AI CALL ASSISTANT
    # =========================================================================
    if selected_tab == "💬 AI Assistant":
        st.header("💬 Gemini Call Transcript Intelligence")
        st.markdown(f"Ask questions across the transcripts in your **{selected_ai_folder}** vault.")
        
        if "No transcript files found" in transcripts_data_str or "Error" in transcripts_data_str:
            st.warning(transcripts_data_str)
        else:
            st.success("🔒 Transcripts loaded securely into AI memory.")
            
            if "chat_history" not in st.session_state:
                st.session_state.chat_history = []
                
            for message in st.session_state.chat_history:
                with st.chat_message(message["role"]):
                    st.markdown(message["content"])
                    
            if user_prompt := st.chat_input("Ask a question about these call transcripts:"):
                st.session_state.chat_history.append({"role": "user", "content": user_prompt})
                with st.chat_message("user"):
                    st.markdown(user_prompt)
                    
                with st.chat_message("assistant"):
                    loader_placeholder = st.empty()
                    loader_placeholder.markdown("""
                    <div style="background-color: #0f172a; padding: 20px; border-radius: 12px; border: 2px dashed #8CC63F; text-align: center; margin-bottom: 15px;">
                        <style>
                            @keyframes wobble {
                                0% { transform: translateX(-20px); }
                                100% { transform: translateX(20px); }
                            }
                            @keyframes chomp-basic {
                                0%, 100% { border-right-color: transparent; }
                                50% { border-right-color: #8CC63F; }
                            }
                            .loader-row {
                                display: flex;
                                justify-content: center;
                                align-items: center;
                                gap: 15px;
                                animation: wobble 1.5s infinite alternate ease-in-out;
                                margin-bottom: 15px;
                            }
                            .pac-body {
                                width: 0; height: 0;
                                border: 20px solid #8CC63F;
                                border-right: 20px solid transparent;
                                border-radius: 50%;
                                animation: chomp-basic 0.3s infinite;
                            }
                        </style>
                        <div class="loader-row">
                            <span style="color: #8CC63F; font-size: 35px; font-weight: 900; font-family: 'Impact', sans-serif;">13</span>
                            <div class="pac-body"></div>
                            <span style="font-size: 25px;">🍪 🍪</span>
                            <span style="color: #3b82f6; font-size: 30px; font-weight: 900; font-family: 'Impact', sans-serif;">14 😱</span>
                        </div>
                        <div style="color: #cbd5e1; font-size: 16px; font-weight: 600; font-family: system-ui, sans-serif;">
                            Dept 13. is munching on 14 while Gemini thinks...
                        </div>
                    </div>
                    """, unsafe_allow_html=True)
                    
                    try:
                        model = genai.GenerativeModel('gemini-3.1-flash-lite')
                        full_prompt = f"""
                        You are an expert QA and Customer Service Analyst for Balance of Nature.
                        Answer the manager's question accurately using ONLY the call transcripts provided below.
                        If the information is not contained in the transcripts, clearly state that you do not have enough data.
                        Be concise, objective, and highlight exact quotes or call examples when relevant.
                        
                        TRANSCRIPT DATABASE:
                        {transcripts_data_str}
                        
                        MANAGER'S QUESTION:
                        {user_prompt}
                        """
                        
                        response = model.generate_content(full_prompt, stream=True)
                        
                        def stream_generator():
                            loader_placeholder.empty()
                            for chunk in response:
                                yield chunk.text

                        full_response = st.write_stream(stream_generator)
                        st.session_state.chat_history.append({"role": "assistant", "content": full_response})
                    except Exception as e:
                        loader_placeholder.empty()
                        st.error(f"Error communicating with Gemini API: {e}")

    # =========================================================================
    # TAB 3: AI TAGGING & INSIGHTS (WITH RADAR & BOTTLE CHARTS)
    # =========================================================================
    elif selected_tab == "🏷️ Tagging & Insights":
        st.header("🏷️ AI Call Tagging & Sentiment Analysis")
        st.markdown(f"Gemini will read the transcripts from **{selected_ai_folder}**, categorize them, and extract key metrics.")
        
        if not transcripts_list:
            st.warning("Please select a valid folder with transcripts in the sidebar.")
        else:
            if st.button("🚀 Run Batch AI Analysis"):
                
                # UI Layout for Batching
                status_text = st.empty()
                progress_bar = st.progress(0)
                
                loader_placeholder = st.empty()
                loader_placeholder.markdown("""
                <div style="background-color: #0f172a; padding: 20px; border-radius: 12px; border: 2px dashed #8CC63F; text-align: center; margin-bottom: 15px;">
                    <style>
                        @keyframes wobble {
                            0% { transform: translateX(-20px); }
                            100% { transform: translateX(20px); }
                        }
                        @keyframes chomp-basic {
                            0%, 100% { border-right-color: transparent; }
                            50% { border-right-color: #8CC63F; }
                        }
                        .loader-row {
                            display: flex;
                            justify-content: center;
                            align-items: center;
                            gap: 15px;
                            animation: wobble 1.5s infinite alternate ease-in-out;
                            margin-bottom: 15px;
                        }
                        .pac-body {
                            width: 0; height: 0;
                            border: 20px solid #8CC63F;
                            border-right: 20px solid transparent;
                            border-radius: 50%;
                            animation: chomp-basic 0.3s infinite;
                        }
                    </style>
                    <div class="loader-row">
                        <span style="color: #8CC63F; font-size: 35px; font-weight: 900; font-family: 'Impact', sans-serif;">13</span>
                        <div class="pac-body"></div>
                        <span style="font-size: 25px;">🍪 🍪</span>
                        <span style="color: #3b82f6; font-size: 30px; font-weight: 900; font-family: 'Impact', sans-serif;">14 😱</span>
                    </div>
                    <div style="color: #cbd5e1; font-size: 16px; font-weight: 600; font-family: system-ui, sans-serif;">
                        Dept 13. is munching on 14 while Gemini processes your call batches...
                    </div>
                </div>
                """, unsafe_allow_html=True)
                
                try:
                    model = genai.GenerativeModel('gemini-3.1-flash-lite')
                    
                    all_json_data = []
                    total_calls = len(transcripts_list)
                    chunk_size = 20 # Processing 20 calls at a time!
                    
                    for i in range(0, total_calls, chunk_size):
                        chunk = transcripts_list[i:i + chunk_size]
                        
                        # Build the string for just this chunk of calls
                        chunk_str = "\n\n".join([f"--- File: {c['file_name']} ---\n{c['content']}" for c in chunk])
                        
                        current_batch = (i // chunk_size) + 1
                        total_batches = (total_calls + chunk_size - 1) // chunk_size
                        status_text.markdown(f"**⏳ Processing batch {current_batch} of {total_batches}...** *(Analyzing calls {i+1} to {min(i+chunk_size, total_calls)})*")
                        
                        prompt = f"""
                        You are a strict QA API analyzing call transcripts. Read all the transcripts provided.
                        You MUST return a valid JSON array of objects. 
                        
                        Each object must represent a single transcript and have EXACTLY these keys:
                        "File Name": (The name of the transcript file)
                        "Primary Topic": (Choose ONE: Cancellation, Product Question, Billing, Angry Customer, Upsell, General Inquiry, or Other)
                        "Sentiment": (Choose ONE: Positive, Neutral, or Negative)
                        "Success Story Asked": (Set to "Yes" if the agent explicitly asked the customer to share a success story or positive health experience with the product, otherwise "No")
                        "Cancellation Reason": (The specific reason they canceled. Set to "N/A" if they did not cancel)
                        "Compliance Violation": (Set to "Yes" if the agent made unapproved health/medical claims treating or curing diseases, otherwise "No")
                        "Products Mentioned": (A comma-separated list of Balance of Nature products mentioned. Example: "Fruits, Veggies, Fiber & Spice". If none, write "None")
                        "Competitors Mentioned": (A comma-separated list of competitor products/brands mentioned. If none, write "None")
                        "Summary": (A 1-sentence summary of the call)
                        
                        Transcripts:
                        {chunk_str}
                        """
                        
                        response = model.generate_content(
                            prompt, 
                            generation_config={"response_mime_type": "application/json"}
                        )
                        
                        batch_data = json.loads(response.text)
                        all_json_data.extend(batch_data)
                        
                        # Update Progress Bar
                        progress = min(1.0, (i + chunk_size) / total_calls)
                        progress_bar.progress(progress)
                        
                        # Add a 3-second delay between batches to respect Google's TPM limit (skip on last batch)
                        if i + chunk_size < total_calls:
                            time.sleep(3)
                    
                    # Consolidate all the batches into one giant DataFrame
                    df_tags = pd.DataFrame(all_json_data)
                    
                    loader_placeholder.empty()
                    status_text.empty()
                    progress_bar.empty()
                    st.success("✅ Batch Analysis Complete!")
                    
                    # --- TOP METRIC CARDS ---
                    m1, m2, m3 = st.columns(3)
                    with m1:
                        success_count = len(df_tags[df_tags['Success Story Asked'].astype(str).str.upper() == 'YES'])
                        st.metric("🌟 Success Stories Asked", success_count)
                    with m2:
                        comp_viol = len(df_tags[df_tags['Compliance Violation'].astype(str).str.upper() == 'YES'])
                        st.metric("🚨 Compliance Violations", comp_viol)
                    with m3:
                        cancellations = len(df_tags[df_tags['Primary Topic'] == 'Cancellation'])
                        st.metric("❌ Total Cancellations", cancellations)
                        
                    st.divider()

                    # --- RADAR & BOTTLE CHARTS ROW ---
                    col_chart1, col_chart2 = st.columns([1.5, 1.5])
                    
                    with col_chart1:
                        st.markdown("**Radar Breakdown: Call Topics**")
                        all_topics = ["Cancellation", "Product Question", "Billing", "Angry Customer", "Upsell", "General Inquiry", "Other"]
                        topic_counts = df_tags['Primary Topic'].value_counts()
                        for topic in all_topics:
                            if topic not in topic_counts:
                                topic_counts[topic] = 0
                        topic_counts = topic_counts.reset_index()
                        topic_counts.columns = ['Topic', 'Count']
                        
                        fig = px.line_polar(
                            topic_counts, 
                            r='Count', 
                            theta='Topic', 
                            line_close=True,
                            color_discrete_sequence=['#8CC63F']
                        )
                        fig.update_traces(fill='toself', fillcolor='rgba(140, 198, 63, 0.4)')
                        fig.update_layout(
                            polar=dict(
                                radialaxis=dict(visible=True, tickfont=dict(color="gray")),
                                angularaxis=dict(tickfont=dict(size=14))
                            ),
                            paper_bgcolor='rgba(0,0,0,0)',
                            plot_bgcolor='rgba(0,0,0,0)',
                            margin=dict(l=40, r=40, t=20, b=20)
                        )
                        st.plotly_chart(fig, use_container_width=True)
                        
                    with col_chart2:
                        st.markdown("**Product Mentions (Share of Call Volume)**")
                        
                        # Safely handle product mention strings
                        total_calls = len(df_tags) if len(df_tags) > 0 else 1
                        prod_str = " ".join(df_tags['Products Mentioned'].fillna("").astype(str).str.lower())
                        
                        f_count = len(df_tags[df_tags['Products Mentioned'].str.lower().str.contains('fruits', na=False)])
                        v_count = len(df_tags[df_tags['Products Mentioned'].str.lower().str.contains('veggies', na=False)])
                        fs_count = len(df_tags[df_tags['Products Mentioned'].str.lower().str.contains('fiber|spice', na=False)])
                        
                        f_pct = min(int((f_count / total_calls) * 100), 100)
                        v_pct = min(int((v_count / total_calls) * 100), 100)
                        fs_pct = min(int((fs_count / total_calls) * 100), 100)
                        
                        st.markdown(f"""
                        <style>
                            .supplement-shelf {{
                                display: flex;
                                justify-content: space-evenly;
                                align-items: flex-end;
                                height: 240px;
                                margin-top: 20px;
                                padding-bottom: 10px;
                                border-bottom: 4px solid #e2e8f0;
                            }}
                            .btl-container {{
                                display: flex;
                                flex-direction: column;
                                align-items: center;
                                cursor: pointer;
                                transition: transform 0.2s;
                            }}
                            .btl-container:hover {{
                                transform: translateY(-5px);
                            }}
                            
                            /* CAPS */
                            .cap-small {{
                                width: 50px; height: 16px;
                                border-radius: 4px 4px 0 0;
                                margin-bottom: -2px;
                                z-index: 2;
                                background-image: repeating-linear-gradient(90deg, transparent, transparent 2px, rgba(0,0,0,0.1) 2px, rgba(0,0,0,0.1) 4px);
                            }}
                            .cap-large {{
                                width: 110px; height: 20px;
                                border-radius: 4px 4px 0 0;
                                margin-bottom: -2px;
                                z-index: 2;
                                background-image: repeating-linear-gradient(90deg, transparent, transparent 2px, rgba(0,0,0,0.1) 2px, rgba(0,0,0,0.1) 4px);
                            }}
                            
                            /* BODIES */
                            .body-small {{
                                width: 66px; height: 110px;
                                border-radius: 12px 12px 8px 8px;
                                position: relative;
                                overflow: hidden;
                                background: #ffffff;
                                border: 3px solid;
                                box-shadow: inset -5px 0px 10px rgba(0,0,0,0.05);
                            }}
                            .body-large {{
                                width: 120px; height: 170px;
                                border-radius: 12px 12px 8px 8px;
                                position: relative;
                                overflow: hidden;
                                background: #ffffff;
                                border: 3px solid;
                                box-shadow: inset -8px 0px 15px rgba(0,0,0,0.05);
                            }}
                            
                            /* COLORS */
                            .f-color {{ border-color: #dc2626; background-color: #ef4444; }}
                            .v-color {{ border-color: #059669; background-color: #10b981; }}
                            .fs-color {{ border-color: #1d4ed8; background-color: #2563eb; }}
                            
                            .fill-f {{ background: #dc2626; position: absolute; bottom: 0; width: 100%; transition: height 1.2s ease-out; opacity: 0.9; }}
                            .fill-v {{ background: #059669; position: absolute; bottom: 0; width: 100%; transition: height 1.2s ease-out; opacity: 0.9; }}
                            .fill-fs {{ background: #1d4ed8; position: absolute; bottom: 0; width: 100%; transition: height 1.2s ease-out; opacity: 0.9; }}
                            
                            /* TEXT */
                            .pct-val {{
                                position: absolute;
                                width: 100%; top: 40%;
                                text-align: center;
                                font-size: 18px; font-weight: 900;
                                color: #1e293b; z-index: 10;
                                text-shadow: 0px 0px 6px rgba(255,255,255,0.9), 0px 0px 6px rgba(255,255,255,0.9);
                            }}
                            .btl-label {{
                                font-weight: 800; font-size: 14px;
                                color: #475569; margin-top: 8px;
                            }}
                        </style>
                        
                        <div class="supplement-shelf">
                            <div class="btl-container" title="Mentioned in {f_count} out of {total_calls} calls">
                                <div class="cap-small f-color"></div>
                                <div class="body-small" style="border-color: #dc2626;">
                                    <div class="pct-val">{f_pct}%</div>
                                    <div class="fill-f" style="height: {f_pct}%;"></div>
                                </div>
                                <div class="btl-label">Fruits</div>
                            </div>
                            <div class="btl-container" title="Mentioned in {v_count} out of {total_calls} calls">
                                <div class="cap-small v-color"></div>
                                <div class="body-small" style="border-color: #059669;">
                                    <div class="pct-val">{v_pct}%</div>
                                    <div class="fill-v" style="height: {v_pct}%;"></div>
                                </div>
                                <div class="btl-label">Veggies</div>
                            </div>
                            <div class="btl-container" title="Mentioned in {fs_count} out of {total_calls} calls">
                                <div class="cap-large fs-color"></div>
                                <div class="body-large" style="border-color: #1d4ed8;">
                                    <div class="pct-val">{fs_pct}%</div>
                                    <div class="fill-fs" style="height: {fs_pct}%;"></div>
                                </div>
                                <div class="btl-label">Fiber & Spice</div>
                            </div>
                        </div>
                        """, unsafe_allow_html=True)

                    st.divider()
                    
                    # --- COMPETITORS & FULL DATABASE ---
                    st.markdown("### ⚠️ Competitor Threat Board")
                    comps_list = df_tags['Competitors Mentioned'].dropna().astype(str).tolist()
                    found_comps = [c.strip() for items in comps_list for c in items.split(',') if c.strip().lower() != 'none']
                    
                    if found_comps:
                        comp_counts = pd.Series(found_comps).value_counts().reset_index()
                        comp_counts.columns = ['Competitor', 'Mentions']
                        st.dataframe(comp_counts, use_container_width=False)
                    else:
                        st.info("No competitors were mentioned in this batch of calls! 🎉")
                        
                    st.markdown("### 📝 Detailed Call Breakdown Database")
                    st.dataframe(df_tags, use_container_width=True)
                    
                    # THE NEW CSV EXPORT BUTTON!
                    csv_export = df_tags.to_csv(index=False).encode('utf-8')
                    st.download_button(
                        label="📥 Download AI Tagging Data to CSV",
                        data=csv_export,
                        file_name=f"AI_Tagging_Export_{selected_ai_folder}.csv",
                        mime="text/csv",
                    )
                    
                except Exception as e:
                    loader_placeholder.empty()
                    status_text.empty()
                    progress_bar.empty()
                    st.error(f"Failed to process analysis. The AI may have struggled to format the JSON. Error: {e}")
