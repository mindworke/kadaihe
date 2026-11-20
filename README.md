# 卡带盒 Kadaihe

卡带盒是一款面向 Nintendo Switch 和 Switch 2 实体卡带收藏者的安卓工具。用它记录每张卡带的版本、购入价格和收纳位置，管理借还和心愿单，并核算售出盈亏。

## 界面预览

| 收藏库 | 卡带详情 | 心愿单 |
| :---: | :---: | :---: |
| <img src="docs/screenshots/collection.jpg" width="230" alt="收藏库的卡带封面网格和投入统计"> | <img src="docs/screenshots/detail.jpg" width="230" alt="卡带详情的封面背景、购入记录和游玩进度"> | <img src="docs/screenshots/wishlist.jpg" width="230" alt="心愿单的目标价和已购入按钮"> |

## 主要功能

- **收藏库**支持扫码、游戏中文名联想、手动选图、实拍留存、排序和筛选。
- **心愿单和流转记录**支持目标价、借入、借出、归还提醒、运费和售出记录。
- **统计**汇总购买支出、借还支出、售出回血和单张均价。
- **封面交互**支持长按封面编辑或删除，详情页下拉可看完整盒面。
- **导入和备份**支持 CSV 导入收藏卡带、CSV 导出，以及包含照片的 ZIP 备份和恢复。

记录保存在设备上。公开发布版本内置部分中文游戏名和别名，封面可从相册选择或拍摄。

## 安装

[直接下载安卓 APK（卡带盒 2.5）](https://github.com/mindworke/kadaihe/releases/download/v2.5/Kadaihe-2.5-github.apk)

需要 Android 8.0（API 26）或以上。更新签名一致的安装包时，可以直接覆盖安装。ZIP 备份可在「设置与备份」中导出。

## 日版封面下载与访问令牌

**先看你装的是哪一版。** GitHub 上的 2.5 安装包可以拍照或从相册挑封面。想让 App 帮你找图，需要用已经接入封面站的版本。打开「设置与备份」，看到「日版封面站」就能按下面的步骤操作。自己打包的话，可以看下方的[封面站构建方法](#可选的自建封面库)。

**令牌填什么？** 令牌就是封面站给你的一串访问码。拿到站点管理员发给你的那串字符，整串复制到 App 里就行。

1. 在手机上打开「设置与备份」→「日版封面站」→「配置令牌」，粘贴后点「保存」。
2. 新增或编辑卡带时，输入游戏的中文名。有明确匹配时，App 会自动下载封面。看到好几个结果，就选你手上那一版，比如 Switch 2 普通版或游戏钥匙卡。
3. 没找到合适的图，可以点「查找日版封面」再试，也可以拍照或从相册换一张。

## 从源码构建

在 Linux 中准备 JDK 17 或以上、Bash 4 或以上、`curl`、`zip` 和 Android SDK。通过 Android Studio 的 SDK Manager 安装 **Android SDK Platform 35** 和 **Android SDK Build-Tools 35.0.0**，然后把 SDK 目录设为 `ANDROID_SDK_ROOT`。

```bash
export ANDROID_SDK_ROOT=/你的/Android/Sdk
bash build.sh
```

第一次构建会从 Maven Central 下载固定版本的 ECJ 和 ZXing，并验证各自的 SHA-256。生成的 `build/Kadaihe-2.5-debug.apk` 会使用本机生成的调试签名。它适合测试。覆盖已有的正式安装需要使用对应的正式签名。

### 正式签名

把签名文件保存在源码目录之外。在本地终端输入密码后运行构建脚本。

```bash
export KADAIBOX_KEYSTORE=/私有路径/release.p12
export KADAIBOX_KEY_ALIAS=你的签名别名
read -rs -p '签名文件密码 ' KADAIBOX_KEYSTORE_PASSWORD
export KADAIBOX_KEYSTORE_PASSWORD
bash build.sh
unset KADAIBOX_KEYSTORE_PASSWORD
```

如果密钥与签名文件使用不同的密码，还需设置 `KADAIBOX_KEY_PASSWORD`。正式安装包输出为 `build/Kadaihe-2.5.apk`。

### 可选的自建封面库

想自己打包一个能联网下载日版封面的版本，可以用下面这条命令。先把示例地址换成你有权使用的封面站地址，再运行。

```bash
KADAIBOX_COVER_ORIGIN=https://covers.example.com bash build.sh
```

装好后，在手机上按上面的步骤填写该站点的访问码。

封面站提供 `/games.json` 和相对 PNG 路径。请求通过 `OAI-Sites-Authorization: Bearer <token>` 附带令牌。可用以下结构编写索引。

```json
{
  "covers": [
    {
      "id": "switch2-example",
      "platform": "switch2",
      "sourceTitle": "示例游戏",
      "chineseTitle": "示例游戏",
      "aliases": [],
      "edition": "普通包装版",
      "width": 1152,
      "height": 951,
      "image": "/covers/switch2/example.png"
    }
  ]
}
```

## 源码结构

- `app/java` 存放安卓入口、扫码、备份、通知与可选封面库接口。
- `app/assets` 存放界面、收藏管理、中文名称索引及 CSV 处理。
- `app/res` 存放图标和安卓主题资源。

扫码使用 [ZXing Core](https://github.com/zxing/zxing)，许可证随源码放在 `app/assets/licenses/zxing.txt`。Nintendo 和 Nintendo Switch 是其权利人的商标。卡带盒是独立收藏工具。
