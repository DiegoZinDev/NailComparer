import sys, json
from pathlib import Path
from docx import Document

def read_docx(file_path: str) -> str:
    path = Path(file_path)
    if not path.exists(): return f"ERRO: {file_path} não encontrado."
    doc = Document(path)
    out = []
    for p in doc.paragraphs:
        if p.text.strip():
            if p.style.name.startswith('Heading'):
                lvl = p.style.name.replace('Heading ', '')
                out.append(f"{'#' * int(lvl) if lvl.isdigit() else '##'} {p.text}")
            else: out.append(p.text)
    for idx, t in enumerate(doc.tables):
        out.append(f"\n[Tabela {idx+1}]")
        for r in t.rows: out.append(" | ".join(c.text.strip().replace('\n', ' ') for c in r.cells))
    return "\n".join(out)

def update_docx(file_path: str, action: str, payload: dict) -> str:
    path = Path(file_path)
    if not path.exists(): return f"ERRO: {file_path} não encontrado."
    doc = Document(path)
    if action == "replace":
        old_t, new_t, ok = payload.get("old_text", ""), payload.get("new_text", ""), False
        for p in doc.paragraphs:
            if old_t in p.text: p.text, ok = p.text.replace(old_t, new_t), True
        for t in doc.tables:
            for r in t.rows:
                for c in r.cells:
                    for p in c.paragraphs:
                        if old_t in p.text: p.text, ok = p.text.replace(old_t, new_t), True
        if not ok: return f"AVISO: '{old_t}' não encontrado."
    elif action == "append_section":
        if payload.get("heading"): doc.add_heading(payload["heading"], level=payload.get("level", 2))
        for txt in payload.get("paragraphs", []): doc.add_paragraph(txt)
    else: return "ERRO: Ação inválida."
    doc.save(path)
    return f"SUCESSO: {file_path} atualizado."

if __name__ == "__main__":
    if len(sys.argv) < 3: sys.exit(1)
    cmd, dpath = sys.argv[1], sys.argv[2]
    if cmd == "read": print(read_docx(dpath))
    elif cmd == "update" and len(sys.argv) >= 5: print(update_docx(dpath, sys.argv[3], json.loads(sys.argv[4])))
