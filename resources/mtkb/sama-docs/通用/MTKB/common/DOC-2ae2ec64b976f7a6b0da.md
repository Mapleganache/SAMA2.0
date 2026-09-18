# FPS0106

- MTKB数据库：common
- 范围：共通
- 技术领域：HMI
- 机床类型：未标注
- 品牌：未标注
- 型号：未标注
- 验证状态：原始资料/待工程验证
- 来源：机床智能体知识库v1/01_通用技术与控制平台/05_FP_HMI/FANUC_PICTURE/05_通用工程实例/AUTO FIND CENTER20200302(1)/AUTO FIND CENTER20200302/FPScript/FPS0106.dat
- 文档编号：DOC-2ae2ec64b976f7a6b0da

## 正文

FPScript Data
0001
0106
write Z workpiece
DVAL[1]=machine[3];
BVAL[1]=rdpmc[12_7999_0];
if(BVAL[1]==1)
{
wrparam[1221_3_12_DVAL[1]_99_0];
}
if(BVAL[1]==2)
{
wrparam[1222_3_12_DVAL[1]_99_0];
}
if(BVAL[1]==4)
{
wrparam[1223_3_12_DVAL[1]_99_0];
}
if(BVAL[1]==8)
{
wrparam[1224_3_12_DVAL[1]_99_0];
}
END
