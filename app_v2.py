import streamlit as st
import pandas as pd
import numpy as np
import json
import plotly.express as px
import time
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from google.oauth2 import service_account
from googleapiclient.discovery import build
import google.generativeai as genai
from supabase import create_client

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
    [data-testid="stSidebar"] {
        background-color: #f6fbf0 !important;
        border-right: 1px solid #dcf0c3;
    }
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
    div[data-testid="metric-container"] {
        background-color: #ffffff;
        border: 1px solid #e2e8f0;
        padding: 5% 10% 5% 10%;
        border-radius: 8px;
        border-top: 4px solid #8CC63F;
        box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1);
    }
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
    @media print {
        section[data-testid="stSidebar"] { display: none !important; }
        header[data-testid="stHeader"] { display: none !important; }
        div[data-testid="stAlert"] { display: none !important; } 
        div[data-testid="stCheckbox"] { display: none !important; } 
        @page { size: letter; margin: 10mm; }
        [data-testid="stAppViewContainer"] { zoom: 0.80 !important; width: 100% !important; }
        div[data-testid="column"] { break-inside: avoid !important; }
    }
</style>
""", unsafe_allow_html=True)

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
AUDIO_FOLDER_ID = "18wGQo88AkkRNSWcFCBMtCNZEQph12jW3"

def get_drive_service():
    try:
        creds_dict = dict(st.secrets["google_service_account"])
        if "private_key" in creds_dict:
            creds_dict["private_key"] = creds_dict["private_key"].replace("\\n", "\n")
        creds = service_account.Credentials.from_service_account_info(
            creds_dict, scopes=['https://www.googleapis.com/auth/drive.readonly']
        )
        return build('drive', 'v3', credentials=creds, cache_discovery=False)
    except Exception as e:
        st.error(f"Failed to connect to Google Drive Service: {e}")
        return None

@st.cache_data(ttl=300)
def get_drive_subfolders(folder_id):
    service = get_drive_service()
    if not service: return {}
    try:
        query = f"'{folder_id}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false"
        results = service.files().list(q=query, fields="files(id, name)").execute()
        return {f['name']: f['id'] for f in results.get('files', [])}
    except Exception as e:
        st.error(f"Error fetching subfolders from Drive: {e}")
        return {}

def download_file_content(file_id, file_name):
    service = get_drive_service()
    if not service: return None
    try:
        request = service.files().get_media(fileId=file_id)
        content = request.execute().decode('utf-8', errors='ignore')
        return {"file_name": file_name, "content": content}
    except Exception:
        return None

@st.cache_data(ttl=600)
def fetch_all_transcripts(target_folder_id):
    service = get_drive_service()
    if not service: return []
    def get_file_metadata_recursively(current_folder_id, path_prefix=""):
        items_to_download = []
        try:
            query = f"'{current_folder_id}' in parents and trashed = false"
            page_token = None
            while True:
                results = service.files().list(
                    q=query, fields="nextPageToken, files(id, name, mimeType)",
                    pageSize=1000, pageToken=page_token
                ).execute()
                items = results.get('files', [])
                for item in items:
                    if item['mimeType'] == 'application/vnd.google-apps.folder':
                        items_to_download.extend(get_file_metadata_recursively(item['id'], path_prefix=f"{path_prefix}{item['name']}/"))
                    else:
                        items_to_download.append((item['id'], f"{path_prefix}{item['name']}"))
                page_token = results.get('nextPageToken')
                if not page_token: break
            return items_to_download
        except Exception:
            return items_to_download

    file_metadata = get_file_metadata_recursively(target_folder_id)
    if not file_metadata: return []
    files_list = []
    with ThreadPoolExecutor(max_workers=20) as executor:
        futures = [executor.submit(download_file_content, f_id, f_name) for f_id, f_name in file_metadata]
        for future in as_completed(futures):
            res = future.result()
            if res: files_list.append(res)
    return files_list

@st.cache_data(ttl=600)
def fetch_audio_files_metadata(target_folder_id):
    service = get_drive_service()
    if not service: return []
    def get_audio_metadata_recursively(current_folder_id):
        audio_items = []
        try:
            query = f"'{current_folder_id}' in parents and trashed = false"
            page_token = None
            while True:
                results = service.files().list(
                    q=query, fields="nextPageToken, files(id, name, mimeType)",
                    pageSize=1000, pageToken=page_token
                ).execute()
                items = results.get('files', [])
                for item in items:
                    if item['mimeType'] == 'application/vnd.google-apps.folder':
                        audio_items.extend(get_audio_metadata_recursively(item['id']))
                    elif item['name'].endswith('.wav') or item['name'].endswith('.mp3'):
                        audio_items.append({'id': item['id'], 'name': item['name']})
                page_token = results.get('nextPageToken')
                if not page_token: break
            return audio_items
        except Exception:
            return audio_items
    return get_audio_metadata_recursively(target_folder_id)

def download_audio_bytes(file_id):
    service = get_drive_service()
    if not service: return None
    try:
        request = service.files().get_media(fileId=file_id)
        return request.execute()
    except Exception as e:
        st.error(f"Error streaming audio file: {e}")
        return None

if "GEMINI_API_KEY" in st.secrets:
    genai.configure(api_key=st.secrets["GEMINI_API_KEY"])

# -------------------------------------------------------------------------
# SUPABASE HELPER FUNCTIONS
# -------------------------------------------------------------------------
@st.cache_resource
def get_supabase_client():
    return create_client(st.secrets["SUPABASE_URL"], st.secrets["SUPABASE_KEY"])

def fetch_all_rows(table_name, order_col=None):
    supabase = get_supabase_client()
    all_rows = []
    page_size = 1000
    start = 0
    while True:
        query = supabase.table(table_name).select("*")
        if order_col:
            query = query.order(order_col)
        response = query.range(start, start + page_size - 1).execute()
        batch = response.data
        all_rows.extend(batch)
        if len(batch) < page_size:
            break
        start += page_size
    return pd.DataFrame(all_rows)

@st.cache_data(ttl=300)
def load_call_scores():
    df = fetch_all_rows("call_scores")
    if df.empty: return df
    df = df.rename(columns={
        "date_range": "Date",
        "agent_name": "Agent",
        "call_id": "Call",
        "category": "Category",
        "score": "Score",
    })
    return df

@st.cache_data(ttl=300)
def load_coaching_feedback():
    df = fetch_all_rows("coaching_feedback")
    if df.empty: return df
    df = df.rename(columns={
        "agent_name": "Agent Name",
        "date_range": "Date Range",
        "top_wins": "Top 3 Wins",
        "top_improvements": "Top 3 Areas for Improvement",
    })
    return df

# -------------------------------------------------------------------------
# DICTIONARY & SCORECARD FUNCTIONS
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
    "BG": "Beginning", "ARC": "ARC & Trust", "OE": "Ownership & Responsibility & Effort",
    "PE": "Personalization & Education", "QC": "Quality Communication", "CL": "Closing",
    "CC": "Call Control", "COMP": "Compliance"
}

SECTION_MAX_SCORES = {
    "Beginning": 10, "ARC & Trust": 20, "Ownership & Responsibility & Effort": 15,
    "Personalization & Education": 25, "Quality Communication": 40, "Closing": 20,
    "Call Control": 25, "Compliance": 25
}

def get_section_name(category):
    cat_upper = str(category).upper()
    for prefix, section in section_map.items():
        if cat_upper.startswith(prefix): return section
    return "Other"

def generate_section_summary(data_df):
    if data_df.empty: return pd.DataFrame()
    call_section_df = data_df.groupby(['Unique_Row_ID', 'Section'])['Score'].sum().reset_index()
    section_summary = call_section_df.groupby('Section')['Score'].mean().reset_index()
    section_summary = section_summary.rename(columns={'Score': 'Avg_Score'})
    section_summary['Max_Display'] = section_summary['Section'].map(SECTION_MAX_SCORES).fillna(10).astype(int)
    section_summary['Avg_Percentage'] = (section_summary['Avg_Score'] / section_summary['Max_Display']) * 100
    section_summary['Score (Raw)'] = section_summary['Avg_Score'].round(1).astype(str) + " / " + section_summary['Max_Display'].astype(str)
    section_summary['Percentage'] = section_summary['Avg_Percentage'].round(1).astype(str) + "%"
    section_order = ["Beginning", "ARC & Trust", "Ownership & Responsibility & Effort", "Personalization & Education", "Quality Communication", "Closing", "Call Control", "Compliance"]
    section_summary['Section'] = pd.Categorical(section_summary['Section'], categories=section_order, ordered=True)
    return section_summary.sort_values('Section').set_index('Section')[['Score (Raw)', 'Percentage']]

def create_section_bar_chart(summary_df, threshold):
    if summary_df.empty: return None
    df_chart = summary_df.reset_index().copy()
    df_chart['Pct_Num'] = pd.to_numeric(df_chart['Percentage'].astype(str).str.replace('%', ''), errors='coerce').fillna(0)
    fig = px.bar(df_chart, x='Pct_Num', y='Section', orientation='h', text=df_chart['Percentage'], labels={'Pct_Num': 'Score (%)', 'Section': ''}, range_x=[0, 100], color_discrete_sequence=['#4682B4'])
    fig.add_vline(x=threshold, line_dash="dash", line_color="#dc2626", annotation_text=f"Target ({threshold}%)")
    fig.update_layout(yaxis={'categoryorder': 'array', 'categoryarray': df_chart['Section'].tolist()[::-1]}, paper_bgcolor='rgba(0,0,0,0)', plot_bgcolor='rgba(0,0,0,0)', margin=dict(l=10, r=20, t=10, b=20), height=330)
    return fig

def generate_meter_bank(data_df, agent_filter):
    if data_df.empty: return pd.DataFrame().style
    if agent_filter in ["All agents", "Sales", "Care"]:
        pivot_df = data_df.pivot_table(index='Agent', columns='Category', values='Score', aggfunc='mean')
    else:
        temp_df = data_df.copy()
        temp_df['Call_Label'] = temp_df['Call'].astype(str) + " (" + temp_df['Clean_Call_Type'].astype(str) + ")"
        pivot_df = temp_df.pivot_table(index='Call_Label', columns='Category', values='Score', aggfunc='mean')
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
# TOP NAVIGATION 
# -------------------------------------------------------------------------
selected_tab = st.radio(
    "Navigation",
    ["📊 Performance Dashboard", "💬 AI Assistant (RAG Graph)", "🧠 LLM Knowledge Wiki (Compiler)"],
    horizontal=True,
    label_visibility="collapsed"
)

st.divider()

# =========================================================================
# TAB 1: QC DASHBOARD
# =========================================================================
if selected_tab == "📊 Performance Dashboard":

    st.sidebar.header("1. Data Source")

    if st.sidebar.button("🔄 Refresh from Supabase"):
        st.cache_data.clear()
        st.sidebar.success("Cache cleared — reloading fresh data.")

    try:
        df = load_call_scores()
        coach_df = load_coaching_feedback()

        if df.empty:
            st.warning("No data found in Supabase yet.")
        else:
            st.sidebar.success(f"Connected to Supabase — {len(df):,} score rows loaded.")
            st.sidebar.divider()

            df['Score'] = pd.to_numeric(df['Score'], errors='coerce').fillna(0)

            # 1. Clean strings strictly to avoid fracturing
            df['Agent'] = df['Agent'].astype(str).str.strip()
            df['Call'] = df['Call'].astype(str).str.strip()

            # 2. Extract first valid MM/DD date from the date string
            extracted_date = df['Date'].astype(str).str.extract(r'(\d{1,2}[-/]\d{1,2})')[0]
            extracted_date = extracted_date.str.replace('-', '/')
            df['Clean_Date'] = pd.to_datetime(extracted_date + "/2026", errors='coerce')

            # 3. Create the bulletproof Unique Key for grouping all 36 questions
            df['Unique_Row_ID'] = (
                df['Clean_Date'].dt.strftime('%Y-%m-%d').fillna('UnknownDate') + '||' +
                df['Agent'].str.lower() + '||' +
                df['Call'].str.lower()
            )

            df['Section'] = df['Category'].apply(get_section_name)

            def detect_call_type(row):
                if 'Call Type' in row.index and pd.notna(row['Call Type']):
                    ct = str(row['Call Type']).strip()
                    if ct in ['Sales', 'Care']:
                        return ct
                call_str = str(row.get('Call', '')).lower()
                return 'Sales' if 'sales' in call_str else 'Care'

            df['Clean_Call_Type'] = df.apply(detect_call_type, axis=1)

            # 4. Group purely by Unique_Row_ID to sum all questions per call
            call_df = df.groupby('Unique_Row_ID').agg({
                'Clean_Date': 'first',
                'Agent': 'first',
                'Call': 'first',
                'Clean_Call_Type': 'first',
                'Score': ['sum', 'count']
            }).reset_index()

            call_df.columns = ['Unique_Row_ID', 'Clean_Date', 'Agent', 'Call', 'Clean_Call_Type', 'Total Raw Score', 'Question_Count']

            # Filter out partial/corrupted entries (only score groups with multiple questions)
            call_df = call_df[call_df['Question_Count'] > 5].copy()

            call_df['Call Percentage'] = (call_df['Total Raw Score'] / 180) * 100

            st.sidebar.header("2. Dashboard Filters")

            min_date = df['Clean_Date'].min()
            max_date = df['Clean_Date'].max()

            if pd.isna(min_date) or pd.isna(max_date):
                st.sidebar.warning("Could not parse dates for filtering.")
                start_date, end_date = None, None
            else:
                date_range = st.sidebar.date_input("SELECT DATE RANGE", value=(min_date.date(), max_date.date()), min_value=min_date.date(), max_value=max_date.date())
                start_date, end_date = date_range if len(date_range) == 2 else (date_range[0], max_date.date())

            compare_mode = st.sidebar.checkbox("⚖️ Enable Date Comparison Mode", value=False)
            start_date_2, end_date_2 = None, None

            if compare_mode:
                st.sidebar.markdown("**COMPARE AGAINST:**")
                date_range_2 = st.sidebar.date_input("SELECT SECOND DATE RANGE", value=(min_date.date(), max_date.date()), min_value=min_date.date(), max_value=max_date.date())
                start_date_2, end_date_2 = date_range_2 if len(date_range_2) == 2 else (date_range_2[0], max_date.date())
                
            st.sidebar.divider()
            
            sorted_agents = sorted([str(a) for a in df['Agent'].dropna().unique() if str(a).strip() != ''])
            sel_agent = st.sidebar.selectbox("FILTER BY AGENT", ["All agents", "Sales", "Care"] + sorted_agents)
            
            sel_coaching_date = "Hide 1-on-1 View"
            agent_coach_data = pd.DataFrame()
            
            if sel_agent not in ["All agents", "Sales", "Care"] and not coach_df.empty:
                if 'Agent Name' in coach_df.columns and 'Date Range' in coach_df.columns:
                    first_name = str(sel_agent).split()[0].strip().lower()
                    coach_df_clean = coach_df.copy()
                    coach_df_clean['First_Name'] = coach_df_clean['Agent Name'].astype(str).apply(lambda x: x.split()[0].strip().lower() if pd.notna(x) else "")
                    agent_coach_data = coach_df_clean[coach_df_clean['First_Name'] == first_name]
                    if not agent_coach_data.empty:
                        avail_dates = agent_coach_data['Date Range'].dropna().unique()
                        sel_coaching_date = st.sidebar.selectbox("🔍 SELECT COACHING DATE RANGE (1-on-1 View)", ["Hide 1-on-1 View"] + list(avail_dates))

            filtered_df = df.copy()
            filtered_call_df = call_df.copy()
            
            if start_date and end_date:
                filtered_df = filtered_df[(filtered_df['Clean_Date'].dt.date >= start_date) & (filtered_df['Clean_Date'].dt.date <= end_date)]
                filtered_call_df = filtered_call_df[(filtered_call_df['Clean_Date'].dt.date >= start_date) & (filtered_call_df['Clean_Date'].dt.date <= end_date)]
            
            filtered_df_2 = pd.DataFrame()
            if compare_mode and start_date_2 and end_date_2:
                filtered_df_2 = df[(df['Clean_Date'].dt.date >= start_date_2) & (df['Clean_Date'].dt.date <= end_date_2)].copy()

            if sel_agent == "Sales":
                filtered_df = filtered_df[filtered_df['Clean_Call_Type'] == 'Sales']
                filtered_call_df = filtered_call_df[filtered_call_df['Clean_Call_Type'] == 'Sales']
                if compare_mode and not filtered_df_2.empty: filtered_df_2 = filtered_df_2[filtered_df_2['Clean_Call_Type'] == 'Sales']
            elif sel_agent == "Care":
                filtered_df = filtered_df[filtered_df['Clean_Call_Type'] == 'Care']
                filtered_call_df = filtered_call_df[filtered_call_df['Clean_Call_Type'] == 'Care']
                if compare_mode and not filtered_df_2.empty: filtered_df_2 = filtered_df_2[filtered_df_2['Clean_Call_Type'] == 'Care']
            elif sel_agent != "All agents":
                filtered_df = filtered_df[filtered_df['Agent'] == sel_agent]
                filtered_call_df = filtered_call_df[filtered_call_df['Agent'] == sel_agent]
                if compare_mode and not filtered_df_2.empty: filtered_df_2 = filtered_df_2[filtered_df_2['Agent'] == sel_agent]

                st.markdown(f"### 👤 Performance Profile: {sel_agent.upper()}")
                agent_call_type_filter = st.radio("Agent Call Type View:", ["Combined", "Sales", "Care"], horizontal=True, label_visibility="collapsed")
                
                if agent_call_type_filter != "Combined":
                    filtered_df = filtered_df[filtered_df['Clean_Call_Type'] == agent_call_type_filter]
                    filtered_call_df = filtered_call_df[filtered_call_df['Clean_Call_Type'] == agent_call_type_filter]
                    if compare_mode and not filtered_df_2.empty: filtered_df_2 = filtered_df_2[filtered_df_2['Clean_Call_Type'] == agent_call_type_filter]

            if filtered_call_df.empty:
                st.warning("No data found for these filters.")
            else:
                col_empty, col_thresh = st.columns([4, 1])
                with col_thresh: pass_threshold = st.number_input("PASS THRESHOLD (%)", value=80, step=1)

                total_calls = len(filtered_call_df)
                avg_call_score = filtered_call_df['Call Percentage'].mean()
                highest_score = filtered_call_df['Call Percentage'].max()
                lowest_score = filtered_call_df['Call Percentage'].min()
                
                pass_rate = (len(filtered_call_df[filtered_call_df['Call Percentage'] >= pass_threshold]) / total_calls) * 100 if total_calls > 0 else 0

                mid_point = start_date + (end_date - start_date) / 2
                first_half = filtered_call_df[filtered_call_df['Clean_Date'].dt.date <= mid_point]
                second_half = filtered_call_df[filtered_call_df['Clean_Date'].dt.date > mid_point]
                
                delta_avg, delta_pass = None, None
                if not first_half.empty and not second_half.empty:
                    delta_avg = second_half['Call Percentage'].mean() - first_half['Call Percentage'].mean()
                    delta_pass = ((len(second_half[second_half['Call Percentage'] >= pass_threshold]) / len(second_half)) * 100) - ((len(first_half[first_half['Call Percentage'] >= pass_threshold]) / len(first_half)) * 100)

                kpi1, kpi2, kpi3, kpi4, kpi5 = st.columns(5)
                kpi1.metric("CALLS GRADED", total_calls)
                kpi2.metric("AVG CALL SCORE", f"{avg_call_score:.1f}%", f"{delta_avg:.1f}% vs first half" if delta_avg is not None else None)
                kpi3.metric("HIGHEST CALL", f"{highest_score:.1f}%")
                kpi4.metric("LOWEST CALL", f"{lowest_score:.1f}%")
                kpi5.metric(f"PASS RATE (>{pass_threshold}%)", f"{pass_rate:.0f}%", f"{delta_pass:.0f}% vs first half" if delta_pass is not None else None)

                st.divider()

                norm_tooltips = {k.replace(" ", "").upper(): v for k, v in question_tooltips.items()}
                col_config = {col: st.column_config.Column(help=norm_tooltips.get(str(col).replace(" ", "").upper())) for col in df['Category'].unique()}

                # =========================================================================
                # 1-ON-1 COACHING VIEW
                # =========================================================================
                if sel_coaching_date != "Hide 1-on-1 View":
                    st.info("🖨️ **How to Export this Scorecard:** Press **Ctrl + P** (or **Cmd + P** on Mac) to open the print menu, then select **'Save as PDF'**.")
                    st.markdown(f"## 📝 COACHING FEEDBACK: {sel_coaching_date}")
                    st.markdown(f"**Agent:** {sel_agent} | **Average Call Score during this period:** {avg_call_score:.1f}%")

                    st.markdown("### 🎯 Automated Action Plan Tracker")
                    historical_df = df[(df['Agent'] == sel_agent) & (df['Clean_Date'].dt.date < start_date)]
                    current_df = filtered_df[filtered_df['Agent'] == sel_agent]
                    
                    if not historical_df.empty and not current_df.empty:
                        lowest_hist = historical_df.groupby('Category')['Score'].mean().reset_index().sort_values('Score').head(3)
                        tracker_data = []
                        for _, row in lowest_hist.iterrows():
                            cat, base_score = row['Category'], row['Score']
                            curr_cat_df = current_df[current_df['Category'] == cat]
                            curr_score = curr_cat_df['Score'].mean() if not curr_cat_df.empty else base_score
                            status = "✅ Resolved" if curr_score >= 4.0 else ("🟡 In Progress" if curr_score > base_score + 0.2 else "🔴 Action Needed")
                            tracker_data.append({"Focus Category": cat, "Baseline Score (Past)": f"{base_score:.1f} / 5.0", "Current Avg (New)": f"{curr_score:.1f} / 5.0", "Trend": f"{curr_score - base_score:+.1f}", "Status": status})
                        st.dataframe(pd.DataFrame(tracker_data), use_container_width=True, hide_index=True)
                    else:
                        st.info("Not enough historical data to generate the Action Plan Tracker for this period.")

                    coach_row = agent_coach_data[agent_coach_data['Date Range'] == sel_coaching_date].iloc[0]
                    st.session_state.current_coach_view = f"{sel_agent}_{sel_coaching_date}"
                    
                    edit_mode = st.checkbox("✏️ Enable Edit Mode (Uncheck this before hitting Ctrl + P to lock in your changes for printing!)", value=False)
                    col_good, col_bad = st.columns(2)
                    with col_good:
                        st.success("### 🌟 Top 3 Wins")
                        wins_val = st.text_area("Edit Wins:", value=coach_row.get('Top 3 Wins', ''), height=350) if edit_mode else st.markdown(coach_row.get('Top 3 Wins', ''))
                    with col_bad:
                        st.error("### ⚠️ Top 3 Areas for Improvement")
                        imp_val = st.text_area("Edit Improvements:", value=coach_row.get('Top 3 Areas for Improvement', ''), height=350) if edit_mode else st.markdown(coach_row.get('Top 3 Areas for Improvement', ''))

                    st.divider()
                    st.info("To return to the main dashboard charts, change the 'Select Coaching Date Range' dropdown in the sidebar back to 'Hide 1-on-1 View'.")

                else:
                    if compare_mode:
                        col_comp_title, col_comp_toggle = st.columns([1, 1])
                        with col_comp_title: st.markdown("**📑 SECTION PERFORMANCE COMPARISON**")
                        with col_comp_toggle: sec_view_comp = st.radio("Display:", ["📊 Chart", "📑 Table"], horizontal=True, label_visibility="collapsed")
                            
                        col_sec1, col_sec2 = st.columns(2)
                        with col_sec1:
                            st.markdown(f"**Period 1 ({start_date.strftime('%m/%d')} to {end_date.strftime('%m/%d')})**")
                            sum_df1 = generate_section_summary(filtered_df)
                            if sec_view_comp == "📑 Table": st.dataframe(sum_df1, use_container_width=True, height=350)
                            else: st.plotly_chart(create_section_bar_chart(sum_df1, pass_threshold), use_container_width=True, key="chart_comp_1")
                            
                        with col_sec2:
                            st.markdown(f"**Period 2 ({start_date_2.strftime('%m/%d')} to {end_date_2.strftime('%m/%d')})**")
                            if filtered_df_2.empty: st.warning("No data for this date range.")
                            else:
                                sum_df2 = generate_section_summary(filtered_df_2)
                                if sec_view_comp == "📑 Table": st.dataframe(sum_df2, use_container_width=True, height=350)
                                else: st.plotly_chart(create_section_bar_chart(sum_df2, pass_threshold), use_container_width=True, key="chart_comp_2")
                                
                        st.divider()
                        st.markdown("**((o)) METER BANK COMPARISON**\n*Legend: 🔴 Critical (1-2) | 🟡 Average (3) | 🟢 Excellent (4-5)*")
                        col_mb1, col_mb2 = st.columns(2)
                        with col_mb1:
                            st.markdown(f"**Period 1**")
                            st.dataframe(generate_meter_bank(filtered_df, sel_agent), use_container_width=True, height=350, column_config=col_config)
                        with col_mb2:
                            st.markdown(f"**Period 2**")
                            if filtered_df_2.empty: st.warning("No data.")
                            else: st.dataframe(generate_meter_bank(filtered_df_2, sel_agent), use_container_width=True, height=350, column_config=col_config)

                    else:
                        col_trend, col_sections = st.columns([2, 1])
                        with col_trend:
                            st.markdown("**📈 SCORE TREND**")
                            st.line_chart(filtered_call_df.groupby('Clean_Date')['Call Percentage'].mean(), height=350, color="#4682B4")
                        
                        with col_sections:
                            col_sec_title, col_sec_toggle = st.columns([1, 1])
                            with col_sec_title: st.markdown("**📑 SECTION PERFORMANCE**")
                            with col_sec_toggle: sec_view_std = st.radio("Display:", ["📊 Chart", "📑 Table"], horizontal=True, label_visibility="collapsed")
                            summary_df = generate_section_summary(filtered_df)
                            if sec_view_std == "📑 Table": st.dataframe(summary_df, use_container_width=True, height=330)
                            else: st.plotly_chart(create_section_bar_chart(summary_df, pass_threshold), use_container_width=True)
                        
                        st.divider()
                        st.markdown("**((o)) METER BANK — CLICK A CELL TO FOCUS COACHING PRIORITIES**\n*Legend: 🔴 Critical (1-2) | 🟡 Average (3) | 🟢 Excellent (4-5)*")
                        st.dataframe(generate_meter_bank(filtered_df, sel_agent), use_container_width=True, height=350, column_config=col_config)

                    st.divider()
                    col_board, col_coach = st.columns([2, 1])

                    with col_board:
                        st.markdown("**AGENT LEADERBOARD (PERIOD 1)**")
                        leaderboard = filtered_call_df.groupby('Agent').agg(CALLS_GRADED=('Call', 'count'), AVG_CALL_SCORE=('Call Percentage', 'mean'))
                        leaderboard['PASS RATE %'] = (filtered_call_df[filtered_call_df['Call Percentage'] >= pass_threshold].groupby('Agent').size() / leaderboard['CALLS_GRADED']).fillna(0) * 100
                        
                        agent_deltas = second_half.groupby('Agent')['Call Percentage'].mean() - first_half.groupby('Agent')['Call Percentage'].mean()
                        def format_trend(x): return "Not enough data" if pd.isna(x) else (f"⬆️ +{x:.1f}%" if x > 0 else (f"⬇️ {x:.1f}%" if x < 0 else "➖ 0.0%"))
                        
                        leaderboard['Trend (vs First Half)'] = leaderboard.index.map(agent_deltas).map(format_trend)
                        leaderboard['AVG_CALL_SCORE'] = leaderboard['AVG_CALL_SCORE'].round(1).astype(str) + '%'
                        leaderboard['PASS RATE %'] = leaderboard['PASS RATE %'].round(0).astype(str) + '%'
                        st.dataframe(leaderboard.sort_values(by='AVG_CALL_SCORE', ascending=False), use_container_width=True)

                        if sel_agent not in ["All agents", "Sales", "Care"]:
                            st.markdown("**INDIVIDUAL CALL BREAKDOWN (PERIOD 1)**")
                            call_breakdown = filtered_call_df[['Clean_Date', 'Call', 'Clean_Call_Type', 'Total Raw Score', 'Call Percentage']].copy().rename(columns={'Clean_Call_Type': 'Call Type', 'Clean_Date': 'Date'})
                            call_breakdown['Status'] = call_breakdown['Call Percentage'].apply(lambda x: "✅ Pass" if x >= pass_threshold else "❌ Fail")
                            call_breakdown['Call Percentage'] = call_breakdown['Call Percentage'].round(1).astype(str) + '%'
                            call_breakdown = call_breakdown.sort_values(by='Date', ascending=False).set_index('Call')
                            st.dataframe(call_breakdown, use_container_width=True)

                            with st.expander("👁️ Inspect Full Call Transcript & Audio Recording"):
                                selected_call_name = st.selectbox("Select a call:", options=call_breakdown.index.unique())
                                if selected_call_name:
                                    search_call_id = re.findall(r'\d{6,8}', str(selected_call_name).strip())[0] if re.findall(r'\d{6,8}', str(selected_call_name).strip()) else str(selected_call_name).strip().lower()
                                    st.markdown(f"### 🔍 Call Audit for ID: `{search_call_id}`")
                                    
                                    vault_transcripts = fetch_all_transcripts(FOLDER_ID)
                                    matched_t = next((t for t in vault_transcripts if search_call_id.lower() in t['file_name'].lower()), None)
                                    matched_a = next((a for a in fetch_audio_files_metadata(AUDIO_FOLDER_ID) if search_call_id.lower() in a['name'].lower()), None)
                                    
                                    st.markdown("#### 🎧 Call Audio Recording")
                                    if matched_a:
                                        st.caption(f"🔊 **Available File:** `{matched_a['name']}`")
                                        if st.button("▶️ Load & Play Audio", key=f"btn_audio_{search_call_id}"):
                                            with st.spinner("Fetching audio stream from Google Drive..."):
                                                audio_bytes = download_audio_bytes(matched_a['id'])
                                                if audio_bytes:
                                                    st.audio(audio_bytes, format="audio/wav")
                                                    st.download_button(label="📥 Download .WAV File", data=audio_bytes, file_name=matched_a['name'], mime="audio/wav")
                                    else: st.warning(f"⚠️ No matching audio file found in Drive containing Call ID `{search_call_id}`.")
                                        
                                    st.divider()
                                    st.markdown("#### 📄 Call Transcript Text")
                                    if matched_t: st.text_area("Raw Transcript Text:", value=matched_t['content'], height=350, disabled=True)
                                    else: st.warning(f"⚠️ No matching transcript text found in Drive containing Call ID `{search_call_id}`.")

                        st.download_button(label="📥 Download Summary CSV", data=leaderboard.to_csv().encode('utf-8'), file_name="qc_summary_export.csv", mime="text/csv")

                    with col_coach:
                        st.markdown("**COACHING PRIORITIES (LOWEST SCORING - PERIOD 1)**")
                        for index, row in filtered_df.groupby('Category')['Score'].mean().reset_index().sort_values(by='Score', ascending=True).head(5).iterrows():
                            st.error(f"**{row['Category']}** \n Avg Score: {row['Score']:.2f} / 5.0")
                            
    except Exception as e:
        st.error(f"⚠️ Unable to load data from Supabase. Details: {e}")
        st.info("Please verify SUPABASE_URL and SUPABASE_KEY are set correctly in secrets.toml.")


# =========================================================================
# AI SIDEBAR & DATA LOADING 
# =========================================================================
else:
    st.sidebar.header("AI Transcript Vault")
    subfolders = get_drive_subfolders(FOLDER_ID)
    selected_ai_folder = st.sidebar.selectbox("Select Week to Analyze:", [f"📅 {name}" for name in sorted(subfolders.keys(), reverse=True)] + ["📁 All Transcripts (All Weeks)"])

    if st.sidebar.button("🔄 Sync Drive Cache"):
        st.cache_data.clear()
        st.sidebar.success("Drive cache cleared!")

    active_target_id = FOLDER_ID if selected_ai_folder == "📁 All Transcripts (All Weeks)" else subfolders.get(selected_ai_folder.replace("📅 ", ""), FOLDER_ID)

    # =========================================================================
    # TAB 2: AI ASSISTANT (RAG GRAPH VIA SUPABASE VECTOR SEARCH + LIVE SCORES)
    # =========================================================================
    if selected_tab == "💬 AI Assistant (RAG Graph)":
        st.header("💬 Gemini Graph RAG & Compliance Intelligence")
        st.markdown("Ask questions across your entire **Supabase LLM Wiki**, **Live QA Call Scores**, and **Coaching Feedback**.")
        
        if "chat_history" not in st.session_state:
            st.session_state.chat_history = []
            
        for message in st.session_state.chat_history:
            with st.chat_message(message["role"]):
                st.markdown(message["content"])
                
        if user_prompt := st.chat_input("Ask a question (e.g., 'How well are agents following the product discovery procedure?' or 'Why are people canceling?'):"):
            st.session_state.chat_history.append({"role": "user", "content": user_prompt})
            with st.chat_message("user"):
                st.markdown(user_prompt)
                
            with st.chat_message("assistant"):
                loader_placeholder = st.empty()
                try:
                    loader_placeholder.markdown("""
                    <div style="background-color: #0f172a; padding: 20px; border-radius: 12px; border: 2px dashed #8CC63F; text-align: center; margin-bottom: 15px;">
                        <div style="color: #cbd5e1; font-size: 16px; font-weight: 600; font-family: system-ui, sans-serif;">
                            🧠 Reading Wiki SOPs, pulling Supabase QA Scores, & searching Vector DB...
                        </div>
                    </div>
                    """, unsafe_allow_html=True)
                    
                    model = genai.GenerativeModel('gemini-3.1-flash-lite')

                    # --- CONVERSATIONAL QUERY REWRITER ---
                    search_query = user_prompt
                    if len(st.session_state.chat_history) > 2:
                        recent_history = "\n".join([f"{m['role']}: {m['content']}" for m in st.session_state.chat_history[-5:-1]])
                        rewrite_prompt = f"""
                        Given the following chat history and follow-up question, rewrite the follow-up question into a single standalone search query. 
                        Replace pronouns like "he", "she", "they", or "it" with the specific agent or topic name mentioned earlier in history.
                        Do NOT answer the question, only output the rewritten standalone query.

                        Chat History:
                        {recent_history}

                        Follow-up Question: {user_prompt}
                        Standalone Search Query:
                        """
                        rewrite_res = model.generate_content(rewrite_prompt)
                        if rewrite_res.text.strip():
                            search_query = rewrite_res.text.strip()

                    # 1. Vector Search across Wiki Pages
                    query_embedding = genai.embed_content(
                        model="models/gemini-embedding-001", 
                        content=search_query,
                        output_dimensionality=768
                    )["embedding"]
                    
                    supabase = get_supabase_client()
                    match_res = supabase.rpc("match_wiki_pages", {"query_embedding": query_embedding, "match_threshold": 0.1, "match_count": 5}).execute()
                    
                    # 2. CONNECTOR: Fetch Quantitative QA Scores & Coaching Summaries from Supabase
                    try:
                        scores_df = load_call_scores()
                        if not scores_df.empty:
                            cat_summary = scores_df.groupby(['Category'])['Score'].agg(['mean', 'count']).reset_index()
                            cat_summary['mean'] = cat_summary['mean'].round(2)
                            cat_context = cat_summary.to_string(index=False)
                        else:
                            cat_context = "No quantitative score records found."

                        coach_df = load_coaching_feedback()
                        if not coach_df.empty:
                            coach_context = coach_df[['Agent Name', 'Date Range', 'Top 3 Wins', 'Top 3 Areas for Improvement']].tail(20).to_string(index=False)
                        else:
                            coach_context = "No coaching feedback records found."
                    except Exception as err:
                        cat_context = f"Could not load score metrics: {err}"
                        coach_context = "Could not load coaching records."

                    # 3. Combine Wiki + Quantitative Scores + Coaching Feedback into Gemini Context
                    if not match_res.data:
                        wiki_context_str = "No specific Wiki pages matched the vector search query."
                    else:
                        wiki_context_str = "\n\n".join([f"--- WIKI PAGE: {row['title']} ---\n{row['content']}" for row in match_res.data])
                        
                    full_prompt = f"""
                    You are an expert QA and Customer Service Intelligence Analyst for Balance of Nature.
                    Answer the manager's question accurately by cross-referencing:
                    1. Our official Wiki Procedures and SOPs
                    2. Quantitative QA Call Scores
                    3. Qualitative Coaching Feedback

                    OFFICIAL WIKI PROCEDURES (SOPs):
                    {wiki_context_str}

                    QUANTITATIVE QA SCORES SUMMARY (CATEGORY AVERAGES OUT OF 5.0):
                    {cat_context}

                    QUALITATIVE COACHING FEEDBACK HIGHLIGHTS:
                    {coach_context}

                    MANAGER'S QUESTION:
                    {user_prompt}

                    INSTRUCTIONS:
                    - Identify which procedure applies in the Wiki and map it to corresponding QA Criteria IDs.
                    - Cross-reference procedural expectations against actual score averages and coaching feedback.
                    - State exact score averages (out of 5.0) and percentages where applicable.
                    - Provide actionable, constructive coaching and process improvement recommendations.
                    """
                    
                    response = model.generate_content(full_prompt, stream=True)
                    loader_placeholder.empty()
                    
                    full_response = st.write_stream(c.text for c in response)
                    st.session_state.chat_history.append({"role": "assistant", "content": full_response})

                except Exception as e:
                    loader_placeholder.empty()
                    st.error(f"Error querying Graph RAG database: {e}")

    # =========================================================================
    # TAB 3: LLM WIKI COMPILER (WRITES TO SUPABASE)
    # =========================================================================
    elif selected_tab == "🧠 LLM Knowledge Wiki (Compiler)":
        st.header("🧠 Compile LLM Knowledge Graph")
        st.markdown("""
        This engine reads your raw transcripts from Google Drive, groups them by entity (Agents, Products, Objections), 
        synthesizes them into compounding **Wiki Pages**, and permanently stores the vector embeddings and links in Supabase.
        """)
        
        transcripts_list = fetch_all_transcripts(active_target_id)
        if not transcripts_list:
            st.warning("Please select a valid folder with transcripts in the sidebar.")
        else:
            st.success(f"📁 {len(transcripts_list)} Transcripts found in the target folder.")
            if st.button("🚀 Run Compiler (Build Wiki Pages)"):
                status_text = st.empty()
                progress_bar = st.progress(0)
                
                try:
                    supabase = get_supabase_client()
                    model = genai.GenerativeModel('gemini-3.1-flash-lite')
                    total_calls = len(transcripts_list)
                    chunk_size = 25 
                    
                    for i in range(0, total_calls, chunk_size):
                        chunk = transcripts_list[i:i + chunk_size]
                        chunk_str = "\n\n".join([f"--- File: {c['file_name']} ---\n{c['content']}" for c in chunk])
                        
                        current_batch = (i // chunk_size) + 1
                        total_batches = (total_calls + chunk_size - 1) // chunk_size
                        status_text.markdown(f"**⏳ Processing batch {current_batch} of {total_batches}...** *(Analyzing calls {i+1} to {min(i+chunk_size, total_calls)})*")
                        
                        prompt = f"""
                        You are a strict Data Extraction API building a Knowledge Wiki. Read these transcripts and group the insights into "Pages".
                        You MUST return a valid JSON array of objects. 
                        
                        Each object must represent a standalone Wiki Page to create or update. Use titles like "Agent Adriel", "Fiber & Spice Product Insights", or "Top Cancellation Reasons".
                        
                        Required Keys:
                        "title": (The name of the wiki page entity)
                        "content": (A robust, professional Markdown summary of everything you learned about this entity in this batch of transcripts)
                        "related_topics": (A list of strings containing exact titles of other pages this page strongly connects to)
                        
                        Transcripts:
                        {chunk_str}
                        """
                        
                        response = model.generate_content(prompt, generation_config={"response_mime_type": "application/json"})
                        raw_text = response.text.strip()
                        start_idx = raw_text.find('[')
                        end_idx = raw_text.rfind(']')
                        clean_text = raw_text[start_idx:end_idx + 1] if start_idx != -1 and end_idx != -1 else raw_text
                            
                        pages_data = json.loads(clean_text)
                        
                        for page in pages_data:
                            title = page.get("title", "Unknown Page").strip()
                            new_content = page.get("content", "").strip()
                            related_titles = page.get("related_topics", [])
                            
                            existing_res = supabase.table("wiki_pages").select("id, content").eq("title", title).execute()
                            
                            if existing_res.data:
                                combined_content = existing_res.data[0]["content"] + "\n\n### New Insights:\n" + new_content
                            else:
                                combined_content = new_content
                                
                            embedding = genai.embed_content(
                                model="models/gemini-embedding-001", 
                                content=combined_content,
                                output_dimensionality=768
                            )["embedding"]
                            
                            upsert_res = supabase.table("wiki_pages").upsert({
                                "title": title,
                                "content": combined_content,
                                "embedding": embedding
                            }, on_conflict="title").execute()
                            
                            if upsert_res.data:
                                source_id = upsert_res.data[0]["id"]
                                
                                for rel_title in related_titles:
                                    target_res = supabase.table("wiki_pages").select("id").eq("title", rel_title.strip()).execute()
                                    if target_res.data:
                                        target_id = target_res.data[0]["id"]
                                        
                                        if source_id != target_id:
                                            link_check = supabase.table("page_links").select("id").eq("source_page_id", source_id).eq("target_page_id", target_id).execute()
                                            
                                            if not link_check.data:
                                                supabase.table("page_links").insert({
                                                    "source_page_id": source_id,
                                                    "target_page_id": target_id,
                                                    "relationship_context": "Linked via transcript batch analysis"
                                                }).execute()
                        
                        progress_bar.progress(min(1.0, (i + chunk_size) / total_calls))
                        if i + chunk_size < total_calls:
                            time.sleep(4)
                    
                    status_text.empty()
                    progress_bar.empty()
                    st.success("✅ Knowledge Wiki Compiled Successfully!")
                    st.balloons()
                    
                except Exception as e:
                    status_text.empty()
                    progress_bar.empty()
                    st.error(f"Failed to compile Wiki. Details: {e}")
            
            st.divider()
            st.markdown("### 📚 Current Wiki Database")
            try:
                supabase = get_supabase_client()
                wiki_res = supabase.table("wiki_pages").select("title, last_updated").order("last_updated", desc=True).execute()
                if wiki_res.data:
                    st.dataframe(pd.DataFrame(wiki_res.data), use_container_width=True)
                else:
                    st.info("No pages found in the Wiki yet. Run the compiler!")
            except Exception as e:
                st.error("Could not fetch Wiki pages from Supabase.")
