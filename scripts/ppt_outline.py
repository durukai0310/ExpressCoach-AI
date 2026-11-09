# -*- coding: utf-8 -*-
"""提取 PPT 内容结构，供答辩 PPT 重构参考"""
import sys
from pptx import Presentation

path = sys.argv[1]
p = Presentation(path)
print('总页数:', len(p.slides))
print('尺寸: %.0f x %.0f pt' % (p.slide_width / 12700, p.slide_height / 12700))
print()
for i, s in enumerate(p.slides, 1):
    texts = []
    for sh in s.shapes:
        if sh.has_text_frame:
            t = sh.text_frame.text.strip()
            if t:
                texts.append(t.replace('\n', ' / ')[:70])
    print(f'--- 第{i}页 ---')
    for t in texts[:5]:
        print('   ', t)
