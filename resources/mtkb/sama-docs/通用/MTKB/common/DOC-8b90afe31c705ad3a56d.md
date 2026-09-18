# FPS0101

- MTKB数据库：common
- 范围：共通
- 技术领域：HMI
- 机床类型：未标注
- 品牌：未标注
- 型号：未标注
- 验证状态：原始资料/待工程验证
- 来源：机床智能体知识库v1/01_通用技术与控制平台/05_FP_HMI/FANUC_PICTURE/05_通用工程实例/AUTO FIND CENTER20200302(1)/AUTO FIND CENTER20200302/FPScript/FPS0101.dat
- 文档编号：DOC-8b90afe31c705ad3a56d

## 正文

FPScript Data
0001
0101
write macro
BVAL[1]=rdcursor[2_0_0_0_0_0_99_0];

DVAL[2]= machine(1);
DVAL[3]= machine(2);
if(BVAL[1] == 1)
{
wrmacro[500_DVAL[2]_3_99_0];
}
if(BVAL[1] == 2)
{
wrmacro[501_DVAL[2]_3_99_0];
}
if(BVAL[1] == 3)
{
wrmacro[502_DVAL[3]_3_99_0];
}
if(BVAL[1] == 4)
{
wrmacro[503_DVAL[3]_3_99_0];
}
end
