from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from pathlib import Path
from pypdf import PdfReader
out=Path('output/pdf')
s=getSampleStyleSheet()
s['Title'].textColor=colors.HexColor('#123D48')
s['Heading2'].textColor=colors.HexColor('#123D48')
s['BodyText'].fontSize=10
s['BodyText'].leading=15
s['BodyText'].spaceAfter=9

def p(t,style='BodyText'): return Paragraph(t,s[style])
def table(rows,widths):
    t=Table([[p(str(c)) for c in r] for r in rows],colWidths=widths,repeatRows=1)
    t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),colors.HexColor('#E1EFF0')),('VALIGN',(0,0),(-1,-1),'TOP'),('GRID',(0,0),(-1,-1),.4,colors.HexColor('#BCCBCD')),('LEFTPADDING',(0,0),(-1,-1),9),('RIGHTPADDING',(0,0),(-1,-1),9),('TOPPADDING',(0,0),(-1,-1),7),('BOTTOMPADDING',(0,0),(-1,-1),3)]))
    return t

def footer(canvas,doc):
    canvas.setFont('Helvetica',8);canvas.setFillColor(colors.HexColor('#52656A'))
    canvas.drawString(48,28,'ECOAGENT TEST FIXTURE  |  Synthetic data - not real business evidence')
    canvas.drawRightString(564,28,f'Page {doc.page}')

def build(name,items):
    SimpleDocTemplate(str(out/name),pagesize=(612,792),rightMargin=48,leftMargin=48,topMargin=44,bottomMargin=48,title=name.replace('_',' '),author='EcoAgent Test Fixtures').build(items,onFirstPage=footer,onLaterPages=footer)

items=[p('Northstar Support Pilot','Title'),p('Accuracy test source | Fixture NS-2026-01 | Revision 2'),p('This fictional report is designed to test document extraction, grounded answers and simple calculations. All company names, rates and measurements are synthetic. These rates are not current provider pricing.'),p('1. Scope and definitions','Heading2'),p('The pilot covered September 1-30, 2026. Project owner: Maya Chen. Currency: USD. The workload contained 1,000 requests: 600 classification, 250 extraction and 150 summarization requests.'),p('A request succeeds when the service returns a response. A response passes quality only when it meets the task-specific answer rubric. Success and quality are separate outcomes.'),p('2. Observed pilot results','Heading2'),table([['Metric','Baseline','Candidate'],['Requests attempted','1,000','1,000'],['Successful responses','990','980'],['Quality-passing responses','950','940'],['Median latency','820 ms','640 ms'],['95th-percentile latency','1,700 ms','1,900 ms'],['Total API cost, including failed attempts','$12.50','$8.00']],[236,140,140]),Spacer(1,12),p('Quality-passing responses are a subset of successful responses. In this report, quality-pass rate uses all attempted requests as its denominator. Cost per quality-passing response uses total API cost divided by quality-passing responses.'),p('The two configurations were both executed during evaluation. Their combined cost is evaluation expenditure. The difference between their costs is a modeled saving for serving the same volume using only one configuration.'),PageBreak(),p('Usage and calculation details','Title'),p('3. Single-request billing example','Heading2'),p('Request NS-041 used the fictional model Cedar-S. Provider-reported input tokens: 12,000, including 3,000 cached-read tokens. Output tokens: 2,000, including 500 reasoning tokens. Total tokens: 14,000. Reasoning tokens are already included in output tokens.'),table([['Disjoint billable category','Tokens','USD per million'],['Uncached input','9,000','$0.20'],['Cached-read input','3,000','$0.05'],['Output (includes reasoning)','2,000','$0.80']],[266,100,150]),Spacer(1,12),p('No cache writes, tool charges or other charges applied to NS-041. Calculate each category as tokens multiplied by its rate divided by 1,000,000. Do not add reasoning tokens to output tokens again.'),p('4. Revisions and missing information','Heading2'),p('Revision 1 listed candidate cost as $7.60. That figure omitted $0.40 of failed-attempt charges. Revision 2 supersedes it: the authoritative candidate total is $8.00, including all attempts.'),p('The report does not provide measured electricity use, GPU type, provider region, October traffic, or the exact calendar date of the next pilot. No claim about those facts can be supported by this document.'),p('5. Policy and projection assumptions','Heading2'),p('The release policy requires an all-attempt quality-pass rate of at least 94.5%. There is no rounding before applying this threshold. A lower cost alone does not satisfy the policy.'),p('For a hypothetical month with 100,000 requests, assume exactly the same task mix, cost per attempted request and performance rates as this pilot. Assume no additional router, verification or fallback charges. This is a linear projection, not observed production spend.'),p('Lower median latency does not imply better tail latency. Lower API cost does not prove lower physical energy use.'),PageBreak(),p('Questions for the app','Title'),p('Answer using only this PDF. Cite the source page and section for each answer. For calculations, show the formula and units. If information is missing, say "Not provided in the document." Do not use external facts.' )]
qs=[
('Q01','Who owns the pilot, and what dates did it cover?','Maya Chen; September 1-30, 2026.','1, section 1'),
('Q02','What percentage of requests were extraction tasks?','250 / 1,000 x 100 = 25%.','1, section 1'),
('Q03','What were the candidate request-success rate and all-attempt quality-pass rate?','Success: 980 / 1,000 = 98%. Quality: 940 / 1,000 = 94%.','1, section 2'),
('Q04','Does the candidate meet the release quality threshold?','No. 94% is below 94.5% by 0.5 percentage points.','1, section 2; 2, section 5'),
('Q05','What were the modeled cost saving per 1,000 requests and percentage reduction?','$12.50 - $8.00 = $4.50; $4.50 / $12.50 x 100 = 36%.','1, section 2; 2, section 4'),
('Q06','How much did running both configurations actually cost?','$12.50 + $8.00 = $20.50 evaluation expenditure.','1, section 2'),
('Q07','What is the candidate cost per quality-passing response, rounded to six decimal places?','$8.00 / 940 = $0.008511 per quality-passing response.','1, section 2'),
('Q08','Did candidate median latency and 95th-percentile latency both improve?','No. Median decreased 180 ms (820 - 640); p95 increased 200 ms (1,900 - 1,700).','1, section 2'),
('Q09','For NS-041, report uncached input, cached input, output, reasoning and total tokens.','9,000 uncached; 3,000 cached; 2,000 output including 500 reasoning; 14,000 total.','2, section 3'),
('Q10','Calculate the full NS-041 API cost and each component.','Uncached $0.001800; cache read $0.000150; output $0.001600; total $0.003550. No extra reasoning charge.','2, section 3'),
('Q11','Should the candidate pilot cost be reported as $7.60 or $8.00, and why?','$8.00. Revision 2 adds $0.40 failed-attempt charges and supersedes revision 1.','2, section 4'),
('Q12','Under the stated 100,000-request projection, what are baseline cost, candidate cost and savings?','$1,250 baseline; $800 candidate; $450 savings. Multiply pilot costs by 100. Hypothetical, not observed.','1, section 2; 2, section 5'),
('Q13','How many kWh of measured electricity did the candidate save?','Not provided in the document. Do not infer electricity from API cost.','2, sections 4-5'),
('Q14','What GPU type and provider region were used?','Not provided in the document for either field.','2, section 4'),
('Q15','Summarize whether the candidate should be released under the stated policy in two sentences.','Must mention lower cost but failure of the quality threshold; also distinguish improved median from worse p95. Do not recommend release as policy-compliant.','1, section 2; 2, section 5')]
for id,q,a,ref in qs: items.append(p(f'<b>{id}.</b> {q}'))
build('ecoagent_accuracy_test.pdf',items)
key=[p('Evaluator Answer Key','Title'),p('Keep this separate from the PDF uploaded to the app. Fixture NS-2026-01.'),p('Score each question out of 2: 1 point for a correct, complete answer and 1 point for a valid source-page/section citation. Maximum: 30 points. For Q15, accept equivalent wording that includes all three required tradeoffs. Numerical equivalence is acceptable unless a precision is specified.'),p('An unsupported factual answer to Q13 or Q14 is a hallucination flag regardless of total score. Track answer accuracy (15 points) separately from citation accuracy (15 points). This small synthetic test is diagnostic; it does not establish general model accuracy.')]
for i,(id,q,a,ref) in enumerate(qs):
    if i in (5,10):key.append(PageBreak())
    key += [p(f'{id} | {q}','Heading2'),p(a),p(f'<b>Evidence:</b> source PDF page {ref}.')]
key += [Spacer(1,8),p('Testing procedure','Heading2'),p('Upload only the source PDF. Submit Q01-Q15 individually or as one batch using the instructions on page 3. Save model ID, full answer, citations, tokens, latency and cost. Test each model against the same PDF and questions. Compare against this key manually; do not treat successful HTTP requests as correct answers.')]
build('ecoagent_accuracy_answer_key.pdf',key)
for f in out.glob('ecoagent_accuracy_*.pdf'):
    r=PdfReader(str(f));print(f, 'pages:',len(r.pages),'text characters:',sum(len(p.extract_text()) for p in r.pages))
    assert len(r.pages)==3
    assert all(len(p.extract_text())>100 for p in r.pages)
