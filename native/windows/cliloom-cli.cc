#ifndef UNICODE
#define UNICODE
#endif
#ifndef _UNICODE
#define _UNICODE
#endif
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#ifndef NOMINMAX
#define NOMINMAX
#endif

#include <windows.h>

#include <cwctype>
#include <string>
#include <vector>

namespace {

constexpr int kLauncherErrorExitCode = 10;
constexpr size_t kMaximumCommandLineCharacters = 32'767;

std::wstring formatWindowsError(DWORD errorCode) {
  wchar_t* message = nullptr;
  const DWORD length = FormatMessageW(
    FORMAT_MESSAGE_ALLOCATE_BUFFER |
      FORMAT_MESSAGE_FROM_SYSTEM |
      FORMAT_MESSAGE_IGNORE_INSERTS,
    nullptr,
    errorCode,
    0,
    reinterpret_cast<wchar_t*>(&message),
    0,
    nullptr
  );
  if (length == 0 || message == nullptr) {
    return L"Windows error " + std::to_wstring(errorCode);
  }

  std::wstring result(message, length);
  LocalFree(message);
  while (!result.empty() && (result.back() == L'\r' || result.back() == L'\n')) {
    result.pop_back();
  }
  return result;
}

void writeLauncherError(const std::wstring& message) {
  const std::wstring output = L"cliloom: " + message + L"\r\n";
  const HANDLE stderrHandle = GetStdHandle(STD_ERROR_HANDLE);
  if (stderrHandle == nullptr || stderrHandle == INVALID_HANDLE_VALUE) return;

  const int requiredBytes = WideCharToMultiByte(
    CP_UTF8,
    0,
    output.data(),
    static_cast<int>(output.size()),
    nullptr,
    0,
    nullptr,
    nullptr
  );
  if (requiredBytes <= 0) return;
  std::string encoded(static_cast<size_t>(requiredBytes), '\0');
  WideCharToMultiByte(
    CP_UTF8,
    0,
    output.data(),
    static_cast<int>(output.size()),
    encoded.data(),
    requiredBytes,
    nullptr,
    nullptr
  );
  DWORD written = 0;
  WriteFile(stderrHandle, encoded.data(), static_cast<DWORD>(encoded.size()), &written, nullptr);
}

std::wstring quoteCommandLineArgument(const std::wstring& argument) {
  if (!argument.empty()) {
    bool needsQuotes = false;
    for (const wchar_t character : argument) {
      if (std::iswspace(character) || character == L'"') {
        needsQuotes = true;
        break;
      }
    }
    if (!needsQuotes) return argument;
  }

  std::wstring quoted = L"\"";
  size_t backslashCount = 0;
  for (const wchar_t character : argument) {
    if (character == L'\\') {
      backslashCount += 1;
      continue;
    }
    if (character == L'"') {
      quoted.append(backslashCount * 2 + 1, L'\\');
      quoted.push_back(L'"');
      backslashCount = 0;
      continue;
    }
    quoted.append(backslashCount, L'\\');
    backslashCount = 0;
    quoted.push_back(character);
  }
  quoted.append(backslashCount * 2, L'\\');
  quoted.push_back(L'"');
  return quoted;
}

std::wstring buildChildCommandLine(int argumentCount, wchar_t* arguments[]) {
  std::wstring commandLine;
  for (int index = 1; index < argumentCount; index += 1) {
    if (!commandLine.empty()) commandLine.push_back(L' ');
    commandLine += quoteCommandLineArgument(arguments[index]);
  }
  return commandLine;
}

HANDLE createInheritedNullHandle(DWORD standardHandle) {
  SECURITY_ATTRIBUTES securityAttributes{
    sizeof(SECURITY_ATTRIBUTES),
    nullptr,
    TRUE
  };
  const DWORD access = standardHandle == STD_INPUT_HANDLE ? GENERIC_READ : GENERIC_WRITE;
  return CreateFileW(
    L"NUL",
    access,
    FILE_SHARE_READ | FILE_SHARE_WRITE,
    &securityAttributes,
    OPEN_EXISTING,
    FILE_ATTRIBUTE_NORMAL,
    nullptr
  );
}

HANDLE duplicateStandardHandle(DWORD standardHandle) {
  const HANDLE source = GetStdHandle(standardHandle);
  if (source == nullptr || source == INVALID_HANDLE_VALUE) {
    return createInheritedNullHandle(standardHandle);
  }

  HANDLE duplicate = INVALID_HANDLE_VALUE;
  if (!DuplicateHandle(
    GetCurrentProcess(),
    source,
    GetCurrentProcess(),
    &duplicate,
    0,
    TRUE,
    DUPLICATE_SAME_ACCESS
  )) {
    return INVALID_HANDLE_VALUE;
  }
  return duplicate;
}

void closeIfValid(HANDLE handle) {
  if (handle != nullptr && handle != INVALID_HANDLE_VALUE) CloseHandle(handle);
}

}  // namespace

int wmain(int argumentCount, wchar_t* arguments[]) {
  if (argumentCount < 2 || arguments[1][0] == L'\0') {
    writeLauncherError(L"the internal Electron executable path is missing");
    return kLauncherErrorExitCode;
  }

  std::wstring commandLine = buildChildCommandLine(argumentCount, arguments);
  if (commandLine.size() + 1 > kMaximumCommandLineCharacters) {
    writeLauncherError(L"the command line exceeds the Windows limit");
    return kLauncherErrorExitCode;
  }
  std::vector<wchar_t> mutableCommandLine(commandLine.begin(), commandLine.end());
  mutableCommandLine.push_back(L'\0');

  const HANDLE stdinHandle = duplicateStandardHandle(STD_INPUT_HANDLE);
  const HANDLE stdoutHandle = duplicateStandardHandle(STD_OUTPUT_HANDLE);
  const HANDLE stderrHandle = duplicateStandardHandle(STD_ERROR_HANDLE);
  if (
    stdinHandle == INVALID_HANDLE_VALUE ||
    stdoutHandle == INVALID_HANDLE_VALUE ||
    stderrHandle == INVALID_HANDLE_VALUE
  ) {
    const DWORD errorCode = GetLastError();
    closeIfValid(stdinHandle);
    closeIfValid(stdoutHandle);
    closeIfValid(stderrHandle);
    writeLauncherError(L"unable to inherit standard handles: " + formatWindowsError(errorCode));
    return kLauncherErrorExitCode;
  }

  STARTUPINFOW startupInfo{};
  startupInfo.cb = sizeof(STARTUPINFOW);
  startupInfo.dwFlags = STARTF_USESTDHANDLES;
  startupInfo.hStdInput = stdinHandle;
  startupInfo.hStdOutput = stdoutHandle;
  startupInfo.hStdError = stderrHandle;
  PROCESS_INFORMATION processInformation{};

  const BOOL started = CreateProcessW(
    arguments[1],
    mutableCommandLine.data(),
    nullptr,
    nullptr,
    TRUE,
    CREATE_UNICODE_ENVIRONMENT,
    nullptr,
    nullptr,
    &startupInfo,
    &processInformation
  );
  const DWORD startError = started ? ERROR_SUCCESS : GetLastError();
  closeIfValid(stdinHandle);
  closeIfValid(stdoutHandle);
  closeIfValid(stderrHandle);

  if (!started) {
    writeLauncherError(L"unable to start the CLI runtime: " + formatWindowsError(startError));
    return kLauncherErrorExitCode;
  }

  CloseHandle(processInformation.hThread);
  const DWORD waitResult = WaitForSingleObject(processInformation.hProcess, INFINITE);
  if (waitResult != WAIT_OBJECT_0) {
    const DWORD waitError = GetLastError();
    TerminateProcess(processInformation.hProcess, kLauncherErrorExitCode);
    WaitForSingleObject(processInformation.hProcess, INFINITE);
    CloseHandle(processInformation.hProcess);
    writeLauncherError(L"unable to wait for the CLI runtime: " + formatWindowsError(waitError));
    return kLauncherErrorExitCode;
  }

  DWORD exitCode = kLauncherErrorExitCode;
  if (!GetExitCodeProcess(processInformation.hProcess, &exitCode)) {
    const DWORD exitError = GetLastError();
    CloseHandle(processInformation.hProcess);
    writeLauncherError(L"unable to read the CLI exit code: " + formatWindowsError(exitError));
    return kLauncherErrorExitCode;
  }
  CloseHandle(processInformation.hProcess);
  return static_cast<int>(exitCode);
}
