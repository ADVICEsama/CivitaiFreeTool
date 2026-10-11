"""Read-only prompt extraction. Never execute custom nodes, templates or cached UI outputs."""
import json

PARSER_REVISION = 'comfy-prompts-2'
SAMPLERS = ('KSampler', 'KSamplerAdvanced', 'SamplerCustom', 'SamplerCustomAdvanced')
WEILIN = 'WeiLinPromptUIWithoutLora'


def ui_graph(workflow):
    """Convert only known widget layouts; disabled/bypassed nodes are not prompt sources."""
    if not isinstance(workflow, dict):
        return {}
    raw_links = workflow.get('links') or []
    raw_nodes = workflow.get('nodes') or []
    if not isinstance(raw_links, list) or not isinstance(raw_nodes, list):
        return {}
    links = {str(v[0]): v for v in raw_links
             if isinstance(v, list) and len(v) >= 6}
    graph = {}
    for node in raw_nodes[:10000]:
        if not isinstance(node, dict) or node.get('mode', 0) in (2, 4):
            continue
        kind = node.get('type', '')
        ins = {}
        widgets = node.get('widgets_values') or []
        if isinstance(widgets, list):
            names = ('text',) if kind == 'CLIPTextEncode' else (
                ('positive', 'auto_random', 'temp_str', 'random_template') if kind == WEILIN else ())
            ins.update(zip(names, widgets))
        ports = node.get('inputs') or []
        for port in ports if isinstance(ports, list) else []:
            if not isinstance(port, dict):
                continue
            link = links.get(str(port.get('link')))
            if link:
                ins[port.get('name', '')] = [str(link[1]), link[2]]
        graph[str(node.get('id'))] = {'class_type': kind, 'inputs': ins,
                                     '_meta': {'title': node.get('title', '')}}
    return graph


def extract_prompts(graph=None, workflow=None):
    """API execution graph is authoritative; UI graph is only a fallback when API is absent."""
    api_present = isinstance(graph, dict) and bool(graph)
    graph = graph if api_present else ui_graph(workflow)
    if isinstance(graph.get('prompt'), dict):
        graph = graph['prompt']
    if len(graph) > 10000:
        return {}
    graph = {str(k): v for k, v in graph.items() if isinstance(v, dict)}
    notes = []

    def note(value):
        if value not in notes:
            notes.append(value)

    def reference(value):
        return isinstance(value, list) and len(value) == 2 and str(value[0]) in graph

    def resolve_text(value, trail=()):
        if isinstance(value, str):
            return value
        if not reference(value) or len(trail) >= 64:
            note('外接文字未记录可读取的输出；显示已保存的提示词，不猜测动态内容。')
            return ''
        key, slot = str(value[0]), value[1]
        if key in trail:
            note('提示词连接存在循环，已停止读取。')
            return ''
        node = graph[key]; kind = node.get('class_type'); ins = node.get('inputs') or {}
        if not isinstance(ins, dict):
            return ''
        trail = (*trail, key)
        if kind == WEILIN and slot == 0:
            return weilin(ins, trail)
        if slot == 0 and kind in ('CR Text', 'StringConstant', 'PrimitiveString', 'PrimitiveStringMultiline'):
            return resolve_text(ins.get('text', ins.get('value', '')), trail)
        if slot == 0 and kind in ('Reroute', 'Reroute (rgthree)'):
            return resolve_text(next(iter(ins.values()), None), trail)
        # ShowText text_0/widgets may be stale from another run; not an execution output.
        note('外接文字未记录可读取的输出；显示已保存的提示词，不猜测动态内容。')
        return ''

    def weilin(ins, trail):
        positive = resolve_text(ins.get('positive', ''), trail)
        try:
            obj = json.loads(positive)
            if isinstance(obj, dict):
                positive = obj.get('prompt', '')
                if not isinstance(positive, str):
                    positive = ''
        except (ValueError, TypeError):
            pass
        extra = resolve_text(ins.get('opt_text', ''), trail)
        if ins.get('auto_random') and ins.get('random_template'):
            note('WeiLin 启用了随机模板；这里只显示保存的输入，无法重建当次随机输出。')
        return extra + ', ' + positive if extra else positive

    def conditioning(value, trail=()):
        if not reference(value) or len(trail) >= 64:
            return []
        key, slot = str(value[0]), value[1]
        if key in trail:
            note('提示词连接存在循环，已停止读取。'); return []
        node = graph[key]; kind = str(node.get('class_type', '')); ins = node.get('inputs') or {}
        if not isinstance(ins, dict):
            return []
        trail = (*trail, key)
        if kind == 'ConditioningZeroOut':
            return []  # Deliberately do NOT follow its upstream positive text.
        if kind == WEILIN and slot == 1:
            return [weilin(ins, trail)]
        if kind.startswith('CLIPTextEncode') and slot == 0:
            return [resolve_text(ins[f], trail) for f in ('text', 'text_g', 'text_l') if f in ins]
        if kind == 'Reroute' or kind == 'Reroute (rgthree)' or kind.startswith('Conditioning'):
            fields = ins.values() if kind.startswith('Reroute') else (
                v for k, v in ins.items() if k.startswith('conditioning'))
            return [text for ref in fields for text in conditioning(ref, trail)]
        note('部分自定义条件节点无法还原文字，未使用无关节点或旧 UI 输出代替。')
        return []

    samplers = [n for n in graph.values() if n.get('class_type') in SAMPLERS]
    result = {}
    if samplers:
        if len(samplers) > 1:
            note('文件包含多个采样器，当前显示首个采样器实际连接的提示词。')
        ins = samplers[0].get('inputs') or {}
        if not isinstance(ins, dict):
            return {}
        if reference(ins.get('guider')):  # SamplerCustomAdvanced -> Basic/CFGGuider
            guider = graph[str(ins['guider'][0])]
            if guider.get('class_type') in ('BasicGuider', 'CFGGuider', 'DualCFGGuider'):
                ins = guider.get('inputs') or {}
        for side, label in (('positive', 'prompt'), ('negative', 'negativePrompt')):
            ref = ins.get(side, ins.get('conditioning') if side == 'positive' else None)
            if ref is None:
                continue
            texts = list(dict.fromkeys(t for t in conditioning(ref) if t))
            result[label] = '\n'.join(texts)
            if reference(ref) and graph[str(ref[0])].get('class_type') == 'ConditioningZeroOut':
                note(('负向' if side == 'negative' else '正向') + '条件已清零，未使用文本提示词。')
    elif not api_present:
        # UI-only files without a sampler cannot determine polarity by node order.
        clips = [n for n in graph.values() if n.get('class_type') == 'CLIPTextEncode']
        if len(clips) == 1:
            t = resolve_text((clips[0].get('inputs') or {}).get('text', ''))
            if t:
                result['prompt'] = t
                note('仅有 UI 工作流文字，未记录采样器连接，正负用途未核实。')
    if notes:
        result['promptExtractionNote'] = '\n'.join(notes)
    return result


WEIGHT_SUFFIXES = (".safetensors", ".ckpt", ".pt", ".pth", ".gguf", ".bin", ".onnx", ".sft")


def extract_model_references(graph=None, workflow=None):
    """Read saved loader data only. No custom-node execution or prompt-name guesses.

    LoraManager stores active entries in inputs.loras.__value__, or the last UI
    widget. The API graph is authoritative for the same node; stale UI state is
    never merged over it. Disabled entries remain visible separately.
    """
    enabled, disabled = set(), set()
    if isinstance(graph, dict) and isinstance(graph.get("prompt"), dict): graph = graph["prompt"]
    graph = graph if isinstance(graph, dict) else {}
    graph = {str(k): v for k, v in graph.items() if isinstance(v, dict) and v.get("class_type")}
    def entry(value):
        if not isinstance(value, dict): return
        name = value.get("name", value.get("lora", value.get("lora_name", "")))
        if not isinstance(name, str) or not name.strip() or len(name) > 4096: return
        active = value.get("active", value.get("on", value.get("enabled", True)))
        off = active is False or active == 0 or (isinstance(active, str) and active.lower() in ("false", "off", "0"))
        (disabled if off else enabled).add(name.strip())
    def stack(value, depth=0):
        if depth > 8: return
        if isinstance(value, str):
            if len(value) > 2_000_000: return
            try: value = json.loads(value)
            except (ValueError, TypeError): return
        if isinstance(value, dict):
            if "__value__" in value: stack(value["__value__"], depth+1)
            else: entry(value)
        elif isinstance(value, list):
            for item in value[:10000]:
                if isinstance(item, dict): entry(item)
                elif isinstance(item, (list, str)): stack(item, depth+1)
    def node(kind, inputs, widgets=None, active=True):
        widgets = widgets if isinstance(widgets, list) else []
        target = enabled if active else disabled
        for field in ("ckpt_name", "lora_name", "vae_name", "unet_name", "clip_name", "clip_name1", "clip_name2", "clip_name3", "model_name"):
            name = inputs.get(field)
            if isinstance(name, str) and name.strip() and len(name) < 4096: target.add(name.strip())
        if "lora" in str(kind).lower():
            before = set(enabled)
            for field in ("loras", "lora_stack"):
                if field in inputs: stack(inputs[field])
            for field, value in inputs.items():
                if str(field).startswith("lora_") and isinstance(value, dict): entry(value)
            if widgets is not None:
                for widget in widgets if isinstance(widgets, list) else []:
                    if isinstance(widget, (dict, list)): stack(widget)
                    elif isinstance(widget, str) and widget.lstrip().startswith(("{", "[")): stack(widget)
            if not active:
                disabled.update(enabled-before);enabled.intersection_update(before)
        if any(part in str(kind).lower() for part in ("loader", "load", "lora", "checkpoint", "vae", "unet", "diffusion")) and not str(kind).lower().startswith(("cliptextencode", "vaedecode", "vaeencode")):
            for value in widgets or []:
                if isinstance(value, str) and len(value) < 4096 and not any(c in value for c in ("\n", "\r")) and "://" not in value and value.lower().endswith(WEIGHT_SUFFIXES): target.add(value)
    for value in list(graph.values())[:10000]:
        inputs = value.get("inputs") or {}
        if isinstance(inputs, dict): node(value.get("class_type", ""), inputs)
    for value in (workflow.get("nodes") or [])[:10000] if isinstance(workflow, dict) and isinstance(workflow.get("nodes"), list) else []:
        if not isinstance(value, dict) or str(value.get("id")) in graph: continue
        node(value.get("type", ""), {}, value.get("widgets_values") or [], value.get("mode", 0) not in (2, 4))
    return {"models": sorted(enabled), "disabled_models": sorted(disabled-enabled)}
